import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import {
  type ScriptedCall,
  writeClaudeScript,
} from "../helpers/claude-scripts.js";
import { coreConfirmationGate } from "../helpers/core-confirmation-gate.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  collectUntil,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
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
  const text = gate.hold("builder_delete_resource", ARGS)?.content[0]?.text;
  if (text === undefined) throw new Error("the DMS ran a first call");
  return text;
}

const REFUSED_FIRST: ScriptedCall = {
  id: "first",
  name: DELETE,
  input: ARGS,
  answer: { text: coreRefusalText(), isError: true },
};

describe("a deletion the DMS holds, in a chat turn", () => {
  let harness: WsHarness | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    CLAUDE_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function cardsOf(
    calls: readonly ScriptedCall[],
    decision: string,
  ): Promise<unknown[][]> {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-held-call-"));
    CLAUDE_FIXTURE.use("plain");
    process.env.MOCK_CLAUDE_SCRIPT = await writeClaudeScript(
      dir,
      "held",
      calls,
    );
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
    return events
      .filter((msg) => msg.type === "permission_request")
      .map((msg) => [msg.callId, msg.kind]);
  }

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
});
