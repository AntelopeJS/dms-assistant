import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildActivityRecords } from "../../src/audit/activity.js";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { buildAllowed, buildKpi } from "../../src/metrics/aggregate.js";
import {
  type ScriptedCall,
  writeClaudeScript,
} from "../helpers/claude-scripts.js";
import {
  coreConfirmationGate,
  joinedText,
  SESSION,
} from "../helpers/core-confirmation-gate.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  collectUntil,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-held-call";
const DELETE = "mcp__dms__builder_delete_resource";
const ARGS = { ref: "orders" };
const RAN = { text: '{"ok":true}', isError: false };
const RUN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

function coreRefusalText(): string {
  const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
  const refusal = gate.hold(SESSION, "builder_delete_resource", ARGS);
  if (refusal === undefined) throw new Error("the DMS ran a first call");
  return joinedText(refusal);
}

const REFUSED_FIRST: ScriptedCall = {
  id: "first",
  name: DELETE,
  input: ARGS,
  answer: { text: coreRefusalText(), isError: true },
};

let harness: WsHarness | undefined;
let dir: string | undefined;

afterEach(async () => {
  CLAUDE_FIXTURE.reset();
  await harness?.close();
  harness = undefined;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function runTurn(
  calls: readonly ScriptedCall[],
  decision: string,
): Promise<WireMessage[]> {
  dir = await mkdtemp(join(tmpdir(), "dms-assistant-held-call-"));
  CLAUDE_FIXTURE.use("plain");
  process.env.MOCK_CLAUDE_SCRIPT = await writeClaudeScript(dir, "held", calls);
  harness = await startWsHarness({ provider: "claude" });
  const client = await openChat(harness.port);
  const collected = collectUntil(client, {
    timeoutMs: RUN_TIMEOUT_MS,
    until: (msg) => msg.type === "run_done",
    onMessage: (msg, socket) => {
      if (msg.type === "permission_request") {
        answerPermission(socket, msg, decision);
      }
    },
  });
  sendHello(client, CONVERSATION_ID);
  sendUserMessage(client, CONVERSATION_ID, "delete the orders table");
  const events = await collected;
  client.close();
  return events;
}

async function cardsOf(
  calls: readonly ScriptedCall[],
  decision: string,
): Promise<unknown[][]> {
  const events = await runTurn(calls, decision);
  return events
    .filter((msg) => msg.type === "permission_request")
    .map((msg) => [msg.callId, msg.kind]);
}

describe("a deletion the DMS holds, in a chat turn", () => {
  it.each([PERMISSION_DECISIONS.ALLOW_ONCE, PERMISSION_DECISIONS.DENY])(
    "lets the first call through and asks the person once, on its repeat, answered %s (fails a chat that never asks or asks twice)",
    async (decision) => {
      const cards = await cardsOf(
        [
          REFUSED_FIRST,
          { id: "repeat", name: DELETE, input: ARGS, answer: RAN },
        ],
        decision,
      );
      expect(cards).toEqual([["repeat", "destructive"]]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks before a repeat with a key the DMS's tool drops, which the DMS runs (fails a hold keyed on the raw arguments)",
    async () => {
      const cards = await cardsOf(
        [
          REFUSED_FIRST,
          {
            id: "repeat-extra-key",
            name: DELETE,
            input: { ...ARGS, force: true },
            answer: RAN,
          },
        ],
        PERMISSION_DECISIONS.ALLOW_ONCE,
      );
      expect(cards).toEqual([["repeat-extra-key", "destructive"]]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks again before the retry of an approved repeat that failed before the DMS's gate, which the DMS then runs on its hold (fails a release on failure, which skips that card)",
    async () => {
      const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
      const call = (id: string): ScriptedCall => {
        const refusal = gate.hold(SESSION, "builder_delete_resource", ARGS);
        const answer =
          refusal === undefined
            ? RAN
            : { text: joinedText(refusal), isError: true };
        return { id, name: DELETE, input: ARGS, answer };
      };
      const first = call("first");
      const failsBeforeGate: ScriptedCall = {
        id: "repeat-fails",
        name: DELETE,
        input: ARGS,
        answer: {
          text: '{"ok":false,"error":{"code":"unavailable"}}',
          isError: true,
        },
      };
      const retry = call("retry");
      expect(retry.answer).toEqual(RAN);
      const cards = await cardsOf(
        [first, failsBeforeGate, retry],
        PERMISSION_DECISIONS.ALLOW_ONCE,
      );
      expect(cards.map(([callId]) => callId)).toEqual([
        "repeat-fails",
        "retry",
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("the step and the audit of a call the DMS held", () => {
  it(
    "shows the refused first call as held, and audits one deletion, the asked one (fails a held call reported or audited as a failure)",
    async () => {
      const events = await runTurn(
        [
          REFUSED_FIRST,
          { id: "repeat", name: DELETE, input: ARGS, answer: RAN },
        ],
        PERMISSION_DECISIONS.ALLOW_ONCE,
      );
      expect(
        events
          .filter((msg) => msg.type === "tool_call_end")
          .map((msg) => [msg.callId, msg.outcome]),
      ).toEqual([
        ["first", "held"],
        ["repeat", "done"],
      ]);
      const entries = harness?.conversationStore.entries() ?? [];
      const records = buildActivityRecords({
        entries,
        changeSets: [],
        pending: [],
        running: new Set(),
        hostProjectRoot: "/project",
      });
      expect(records.map((r) => [r.tool, r.result, r.isAsked])).toEqual([
        ["builder_delete_resource", "done", true],
      ]);
      const allowed = buildAllowed(
        { records, changeSets: [], entries },
        { fromMs: 0, toMs: Number.MAX_SAFE_INTEGER },
      );
      expect([allowed.deletions, allowed.deletionsAsked]).toEqual([1, 1]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lists an approval the DMS then held as held, under its own tab, and counts only the repeat that ran (fails an approval missing from Activity, a held call shown as not run or as a failure, or counted)",
    async () => {
      const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
      const call = (id: string, args: { ref: string }): ScriptedCall => {
        const refusal = gate.hold(SESSION, "builder_delete_resource", args);
        const answer =
          refusal === undefined
            ? RAN
            : { text: joinedText(refusal), isError: true };
        return { id, name: DELETE, input: args, answer };
      };
      const other = { ref: "customers" };
      await runTurn(
        [
          call("first", ARGS),
          call("other", other),
          call("other-repeat", other),
        ],
        PERMISSION_DECISIONS.ALLOW_ONCE,
      );
      const entries = harness?.conversationStore.entries() ?? [];
      const records = buildActivityRecords({
        entries,
        changeSets: [],
        pending: [],
        running: new Set(),
        hostProjectRoot: "/project",
      });
      expect(
        Object.fromEntries(
          records.map((r) => [
            r.id.split(":").at(-1),
            [r.result, r.resultDetail, r.allowedBy, r.isAsked, r.category],
          ]),
        ),
      ).toEqual({
        other: ["held", undefined, "approved", true, ["asked", "held"]],
        "other-repeat": [
          "done",
          undefined,
          "approved",
          true,
          ["changed", "asked"],
        ],
      });
      const sources = { records, changeSets: [], entries };
      const window = { fromMs: 0, toMs: Date.now() + 60_000 };
      const allowed = buildAllowed(sources, window);
      expect([allowed.deletions, allowed.deletionsAsked]).toEqual([1, 1]);
      expect(buildKpi(sources, "approved", window).value).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("the card of a call the DMS held", () => {
  it(
    "shows the DMS's preview from the refusal, its diff in full (fails a card that shows the raw arguments, cut)",
    async () => {
      const steps = [{ action: "AddModule", module: "shop", version: "1.0.0" }];
      const diff = `--- a/antelope.config.ts\n+++ b/antelope.config.ts\n${"+ //\n".repeat(80)}`;
      const plannedChanges = [
        { path: "antelope.config.ts", kind: "modify", diff },
      ];
      const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
      const refusal = gate.hold(SESSION, "builder_configure_project", {
        steps,
        plannedChanges,
      });
      if (refusal === undefined) throw new Error("the DMS ran a first call");
      const name = "mcp__dms__builder_configure_project";
      const events = await runTurn(
        [
          {
            id: "first",
            name,
            input: { steps },
            answer: { text: joinedText(refusal), isError: true },
          },
          { id: "repeat", name, input: { steps }, answer: RAN },
        ],
        PERMISSION_DECISIONS.ALLOW_ONCE,
      );
      const cards = events.filter((msg) => msg.type === "permission_request");
      expect(cards.map((msg) => [msg.callId, msg.preview])).toEqual([
        [
          "repeat",
          {
            type: "held",
            operation: "builder_configure_project",
            details: { plannedChanges, steps },
          },
        ],
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "shows another call to the held tool as itself, its arguments not as the DMS's preview (fails a card that claims the DMS holds a call it does not)",
    async () => {
      const name = "mcp__dms__builder_map_resources";
      const heldInput = { module: "shop", connection: "pg", resources: [] };
      const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
      const refusal = gate.hold(SESSION, "builder_map_resources", {
        ...heldInput,
        pagesToRemove: ["orders"],
      });
      if (refusal === undefined) throw new Error("the DMS ran a first call");
      const otherInput = {
        module: "shop",
        connection: "pg",
        resources: [{ relation: "public.items" }],
      };
      const events = await runTurn(
        [
          {
            id: "first",
            name,
            input: heldInput,
            answer: { text: joinedText(refusal), isError: true },
          },
          { id: "other", name, input: otherInput, answer: RAN },
        ],
        PERMISSION_DECISIONS.ALLOW_ONCE,
      );
      const cards = events.filter((msg) => msg.type === "permission_request");
      expect(cards.map((msg) => [msg.callId, msg.preview])).toEqual([
        [
          "other",
          {
            type: "held_tool",
            operation: "builder_map_resources",
            args: otherInput,
          },
        ],
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
