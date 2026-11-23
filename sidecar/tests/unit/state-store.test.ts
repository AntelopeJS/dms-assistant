import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATE_INITIAL } from "../../src/constants/state.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const TMP_PREFIX = "dms-assistant-state-";
const STATE_FILE = "state.json";
const FILE_ENCODING = "utf8";

/** A stored message as an older version could have written it. */
interface WrittenMessage {
  role: string;
  content: string;
  timestampMs: number;
  toolName?: string;
  callId?: string;
  outcome?: string;
  allowedBy?: string;
  notice?: { kind: string; timestampMs: number };
}

/** A stored conversation holding the one message. */
function withMessage(message: WrittenMessage) {
  return { messages: [message], createdAtMs: 1, updatedAtMs: 2 };
}

describe("state file parsing", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    filePath = join(dir, STATE_FILE);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ["conversations is null", '{"conversations": null}'],
    ["conversations is missing", "{}"],
    ["conversations is a number", '{"conversations": 3}'],
    ["conversations is a string", '{"conversations": "x"}'],
    ["the file is JSON null", "null"],
    ["the file is a number", "7"],
    ["the file is not JSON", "{not json"],
  ])("reads the empty state when %s", async (_label, contents) => {
    await writeFile(filePath, contents, FILE_ENCODING);
    const store = createStore({ filePath });
    expect(await store.read()).toEqual(STATE_INITIAL);
  });

  it("starts the conversation store empty from a file whose conversations is null", async () => {
    await writeFile(filePath, '{"conversations": null}', FILE_ENCODING);
    const conversations = createConversationStore({
      store: createStore({ filePath }),
    });
    await conversations.loadFromDisk();
    expect(conversations.list(null)).toEqual([]);
  });

  it("keeps the conversations of a well-formed file", async () => {
    const stored = {
      conversations: {
        "conv-1": { messages: [], createdAtMs: 1, updatedAtMs: 2 },
      },
    };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    expect(await createStore({ filePath }).read()).toEqual(stored);
  });

  it("drops a conversation of another shape and keeps the others as written", async () => {
    const kept = {
      messages: [{ role: "user", content: "hi", timestampMs: 1 }],
      createdAtMs: 1,
      updatedAtMs: 2,
      writtenByALaterVersion: true,
    };
    const stored = {
      conversations: {
        "conv-kept": kept,
        "conv-no-messages": { createdAtMs: 1, updatedAtMs: 2 },
        "conv-unknown-role": {
          messages: [{ role: "robot", content: "", timestampMs: 1 }],
          createdAtMs: 1,
          updatedAtMs: 2,
        },
      },
    };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    expect(await createStore({ filePath }).read()).toEqual({
      conversations: { "conv-kept": kept },
    });
  });

  it("sets aside a conversation recorded under Full auto (fails a store that still reads full_auto or full_auto_ended)", async () => {
    const kept = { messages: [], createdAtMs: 1, updatedAtMs: 2 };
    const stored = {
      conversations: {
        "conv-kept": kept,
        "conv-full-auto-call": withMessage({
          role: "tool_result",
          content: "",
          toolName: "Bash",
          callId: "call-1",
          outcome: "done",
          allowedBy: "full_auto",
          timestampMs: 1,
        }),
        "conv-full-auto-ended": withMessage({
          role: "notice",
          content: "",
          notice: { kind: "full_auto_ended", timestampMs: 1 },
          timestampMs: 1,
        }),
      },
    };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    expect(await createStore({ filePath }).read()).toEqual({
      conversations: { "conv-kept": kept },
    });
  });

  it("writes the conversations it set aside back to the file", async () => {
    const unreadable = {
      messages: [{ role: "robot", content: "", timestampMs: 1 }],
      createdAtMs: 1,
      updatedAtMs: 2,
    };
    const kept = { messages: [], createdAtMs: 1, updatedAtMs: 2 };
    const stored = {
      conversations: { "conv-later": unreadable, "conv-kept": kept },
    };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    const store = createStore({ filePath, debounceMs: 0 });
    await store.read();
    const renamed = { ...kept, model: "claude-opus" };
    store.write({ conversations: { "conv-kept": renamed } });
    await store.flush();
    expect(JSON.parse(await readFile(filePath, FILE_ENCODING))).toEqual({
      conversations: { "conv-later": unreadable, "conv-kept": renamed },
    });
  });
});

describe("stored tool names", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    filePath = join(dir, STATE_FILE);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads every tool name as written, the CamelCase ones included", async () => {
    const call = (toolName: string) => ({
      role: "tool_use",
      content: "{}",
      toolName,
      timestampMs: 1,
    });
    const stored = {
      conversations: {
        "conv-1": {
          createdAtMs: 1,
          updatedAtMs: 2,
          messages: [
            call("mcp__dms-assistant__BuilderDeletePage"),
            call("mcp__dms-assistant__Typecheck"),
            call("Read"),
            call("mcp__other__GetCurrentPage"),
            call("BuilderDeletePage"),
            {
              role: "notice",
              content: "",
              timestampMs: 3,
              notice: {
                kind: "permission_expired",
                toolName: "BuilderRemoveField",
                summary: "",
                timestampMs: 3,
              },
            },
          ],
        },
      },
    };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    const messages =
      (await createStore({ filePath }).read()).conversations["conv-1"]
        ?.messages ?? [];
    expect(messages.map((message) => message.toolName)).toEqual([
      "mcp__dms-assistant__BuilderDeletePage",
      "mcp__dms-assistant__Typecheck",
      "Read",
      "mcp__other__GetCurrentPage",
      "BuilderDeletePage",
      undefined,
    ]);
    expect(messages[5]?.notice).toMatchObject({
      toolName: "BuilderRemoveField",
    });
  });
});
