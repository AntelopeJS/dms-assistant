import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANGE_FILE_STATUSES,
  CHANGE_SET_STATES,
  TYPECHECK_OUTCOMES,
} from "../../src/constants/audit.js";
import { z } from "zod";
import type { JsonValue } from "../../src/protocol/json.js";
import { JsonValueSchema } from "../../src/protocol/json.js";
import { createChangeSetStore } from "../../src/state/change-sets.js";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import {
  CHAT_MODES,
  GENERATION_MODES,
} from "../../src/state/settings-types.js";
import { createStore } from "../../src/state/store.js";
import { type ChangeSetRecord, PROVIDER_NAMES } from "../../src/state/types.js";

const TMP_PREFIX = "dms-assistant-formal-load-";
const RUNS = 150;
const MESSAGE_ROLES = ["user", "assistant", "tool_use", "tool_result", "error"];
const NEW_ID = "conv-written-after-load";

/** A JSON object as the file holds it, valid or not. */
type Entry = { [key: string]: JsonValue | undefined };

/** Entries of one file: each id is valid or malformed, and `value` is what the file holds. */
interface FileEntry {
  id: string;
  isValid: boolean;
  value: JsonValue;
}

const extras = fc.dictionary(
  fc.constantFrom("x-future", "x-note", "x-flags"),
  fc.jsonValue(),
  { maxKeys: 2 },
);

const number = fc.integer({ min: 0, max: 2_000_000_000 });

const message = fc
  .record(
    {
      role: fc.constantFrom(...MESSAGE_ROLES),
      content: fc.string(),
      timestampMs: number,
      toolName: fc.string(),
      isRetryable: fc.boolean(),
    },
    { requiredKeys: ["role", "content", "timestampMs"] },
  )
  .chain((base) => extras.map((more) => ({ ...more, ...base })));

const conversation = fc
  .record(
    {
      messages: fc.array(message, { maxLength: 3 }),
      createdAtMs: number,
      updatedAtMs: number,
      provider: fc.constantFrom(...PROVIDER_NAMES),
      model: fc.string(),
      mode: fc.constantFrom(...CHAT_MODES),
      generationMode: fc.constantFrom(...GENERATION_MODES),
      ownerId: fc.string(),
    },
    { requiredKeys: ["messages", "createdAtMs", "updatedAtMs"] },
  )
  .chain((base) => extras.map((more) => ({ ...more, ...base })));

const changeFile = fc.record({
  path: fc.string(),
  status: fc.constantFrom(...CHANGE_FILE_STATUSES),
  added: number,
  removed: number,
});

const changeSet = fc
  .record(
    {
      id: fc.uuid(),
      number: fc.integer({ min: 1, max: 1000 }),
      conversationId: fc.string(),
      title: fc.string(),
      createdAtMs: number,
      agent: fc.constantFrom(...PROVIDER_NAMES),
      scope: fc.constantFrom(...GENERATION_MODES),
      isAutoFix: fc.boolean(),
      overlapped: fc.boolean(),
      files: fc.array(changeFile, { maxLength: 2 }),
      added: number,
      removed: number,
      typecheck: fc.constantFrom(...TYPECHECK_OUTCOMES),
      state: fc.constantFrom(...CHANGE_SET_STATES),
      approvalsNeeded: number,
      builderOps: number,
      beforeTree: fc.string(),
      afterTree: fc.string(),
      askedBy: fc.string(),
    },
    {
      requiredKeys: [
        "id",
        "number",
        "conversationId",
        "title",
        "createdAtMs",
        "agent",
        "scope",
        "isAutoFix",
        "overlapped",
        "files",
        "added",
        "removed",
        "typecheck",
        "state",
        "approvalsNeeded",
        "builderOps",
        "beforeTree",
        "afterTree",
      ],
    },
  )
  .chain((base) => extras.map((more) => ({ ...more, ...base })));

/** Wrong for every required field of both records: none is nullable, and none is an object. */
const wrongType = fc.constantFrom<JsonValue>(null, { wrong: "an object" });

/** `valid` with one thing wrong: a required key gone, or set to a value of the wrong type. */
function corrupt(valid: Entry, required: string[]): fc.Arbitrary<Entry> {
  return fc.constantFrom(...required).chain((key) =>
    fc.oneof(
      fc.constant(
        Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key)),
      ),
      wrongType.map((value) => ({ ...valid, [key]: value })),
    ),
  );
}

const notAnObject = fc.oneof(
  fc.constant(null),
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.array(fc.string(), { maxLength: 2 }),
);

const CONVERSATION_REQUIRED = ["messages", "createdAtMs", "updatedAtMs"];
const CHANGE_SET_REQUIRED = [
  "id",
  "number",
  "conversationId",
  "title",
  "createdAtMs",
  "isAutoFix",
  "files",
  "state",
  "beforeTree",
  "afterTree",
];

const badMessageConversation = conversation.chain((valid) =>
  fc.constantFrom("role", "content", "timestampMs").map((key) => ({
    ...valid,
    messages: [{ role: "user", content: "x", timestampMs: 1, [key]: null }],
  })),
);

const malformedConversation = fc.oneof(
  conversation.chain((valid) => corrupt(valid, CONVERSATION_REQUIRED)),
  badMessageConversation,
  notAnObject,
);

const malformedChangeSet = fc.oneof(
  changeSet.chain((valid) => corrupt(valid, CHANGE_SET_REQUIRED)),
  notAnObject,
);

/** A file's entries: valid and malformed ones in any mix and order. */
/** What a file holds of a generated value: JSON has no `-0`, so the value is read back from its text. */
function asStored(value: JsonValue): JsonValue {
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function mixed(
  valid: fc.Arbitrary<JsonValue>,
  malformed: fc.Arbitrary<JsonValue>,
  idOf: (index: number) => string,
): fc.Arbitrary<FileEntry[]> {
  return fc
    .array(
      fc.oneof(
        valid.map((value) => ({ isValid: true, value: asStored(value) })),
        malformed.map((value) => ({ isValid: false, value: asStored(value) })),
      ),
      { maxLength: 6 },
    )
    .map((entries) =>
      entries.map((entry, index) => ({
        ...entry,
        id: idOf(index),
      })),
    );
}

async function inScratchDir(
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function closureOf(store: ConversationStore, id: string): string | null {
  return "closure" in store ? store.closure(id) : null;
}

const ConversationsFile = z.object({
  conversations: z.record(z.string(), JsonValueSchema),
});
const ChangeSetsFile = z.object({ changeSets: z.array(JsonValueSchema) });

const VALID_CONVERSATION = {
  messages: [{ role: "user", content: "kept", timestampMs: 1 }],
  createdAtMs: 1,
  updatedAtMs: 2,
};
/** The shape that threw the loader and emptied the state: a conversation with no `messages`. */
const NO_MESSAGES = { createdAtMs: 1, updatedAtMs: 2 };

const NEW_CHANGE_SET: ChangeSetRecord = {
  id: "00000000-0000-4000-8000-000000000000",
  number: 1001,
  conversationId: NEW_ID,
  title: "written after load",
  createdAtMs: 1,
  agent: "claude",
  scope: "safe",
  isAutoFix: false,
  overlapped: false,
  files: [],
  added: 0,
  removed: 0,
  typecheck: "skipped",
  state: "applied",
  approvalsNeeded: 0,
  builderOps: 0,
  beforeTree: "a",
  afterTree: "b",
};

describe("loading then writing the stored state (formal target: stored state load keeping valid entries)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps every valid conversation unchanged and sets aside only the malformed ones (fails a loader that drops everything for one malformed conversation)", async () => {
    await fc.assert(
      fc.asyncProperty(
        mixed(conversation, malformedConversation, (index) => `conv-${index}`),
        async (entries) => {
          await inScratchDir(async (dir) => {
            const filePath = join(dir, "state.json");
            const conversations = Object.fromEntries(
              entries.map((entry) => [entry.id, entry.value]),
            );
            await writeFile(filePath, JSON.stringify({ conversations }));
            const store = createConversationStore({
              store: createStore({ filePath, debounceMs: 0 }),
            });
            await store.loadFromDisk();
            store.appendMessage(NEW_ID, {
              role: "user",
              content: "written after load",
              timestampMs: 1,
            });
            await store.flush();
            const written = ConversationsFile.parse(
              JSON.parse(await readFile(filePath, "utf8")),
            );
            const loaded = Object.fromEntries(
              store.entries().map((entry) => [entry.id, entry.conversation]),
            );
            for (const entry of entries.filter((e) => e.isValid)) {
              expect(loaded[entry.id]).toEqual(entry.value);
              expect(written.conversations[entry.id]).toEqual(entry.value);
              expect(closureOf(store, entry.id)).toBeNull();
            }
            expect(Object.keys(loaded).sort()).toEqual(
              [
                ...entries.filter((entry) => entry.isValid).map((e) => e.id),
                NEW_ID,
              ].sort(),
            );
            for (const entry of entries.filter((e) => !e.isValid)) {
              expect(written.conversations[entry.id]).toEqual(entry.value);
              expect(closureOf(store, entry.id)).toBe("set_aside");
            }
          });
        },
      ),
      {
        numRuns: RUNS,
        examples: [
          [
            [
              { id: "conv-0", isValid: true, value: VALID_CONVERSATION },
              { id: "conv-1", isValid: false, value: NO_MESSAGES },
            ],
          ],
        ],
      },
    );
  }, 60_000);

  it("keeps every valid change set unchanged and sets aside only the malformed ones (fails a loader that reads change-sets.json unchecked)", async () => {
    await fc.assert(
      fc.asyncProperty(
        mixed(changeSet, malformedChangeSet, (index) => `slot-${index}`),
        async (entries) => {
          await inScratchDir(async (dir) => {
            const filePath = join(dir, "change-sets.json");
            await writeFile(
              filePath,
              JSON.stringify({
                nextNumber: 1000,
                changeSets: entries.map((entry) => entry.value),
              }),
            );
            const store = createChangeSetStore(filePath);
            await store.load();
            store.add(NEW_CHANGE_SET);
            await store.flush();
            const written = ChangeSetsFile.parse(
              JSON.parse(await readFile(filePath, "utf8")),
            );
            const valid = entries.filter((entry) => entry.isValid);
            expect(store.all()).toEqual([
              ...valid.map((entry) => entry.value),
              NEW_CHANGE_SET,
            ]);
            for (const entry of entries) {
              expect(written.changeSets).toContainEqual(entry.value);
            }
            expect(written.changeSets).toHaveLength(entries.length + 1);
          });
        },
      ),
      { numRuns: RUNS },
    );
  }, 60_000);
});
