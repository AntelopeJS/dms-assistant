import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import {
  type ScriptedCall,
  writeClaudeScript,
} from "../helpers/claude-scripts.js";
import {
  coreConfirmationGate,
  joinedText,
} from "../helpers/core-confirmation-gate.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  createCollector,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WireCollector,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const DELETE = "mcp__dms__builder_delete_resource";
const ARGS = { ref: "orders" };
const PAUSE: ScriptedCall = {
  id: "b-pause",
  name: "Bash",
  input: { command: "node -e \"console.log('hello')\"" },
};
const EVENT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 40_000;

let harness: WsHarness | undefined;
let dir: string | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  CLAUDE_FIXTURE.reset();
  await harness?.close();
  harness = undefined;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

interface Chat {
  socket: WebSocket;
  events: WireCollector;
}

async function startChat(
  conversationId: string,
  calls: readonly ScriptedCall[],
  autoAllow: (msg: WireMessage) => boolean,
): Promise<Chat> {
  if (harness === undefined || dir === undefined) throw new Error("no harness");
  process.env.MOCK_CLAUDE_SCRIPT = await writeClaudeScript(
    dir,
    conversationId,
    calls,
  );
  const socket = await openChat(harness.port);
  sockets.push(socket);
  const events = createCollector(socket, EVENT_TIMEOUT_MS);
  socket.on("message", () => {
    const msg = events.events.at(-1);
    if (msg?.type === "permission_request" && autoAllow(msg)) {
      answerPermission(socket, msg, PERMISSION_DECISIONS.ALLOW_ONCE);
    }
  });
  sendHello(socket, conversationId);
  sendUserMessage(socket, conversationId, "delete the orders table");
  return { socket, events };
}

function cardFor(callId: string) {
  return (msg: WireMessage) =>
    msg.type === "permission_request" && msg.callId === callId;
}

const isRunDone = (msg: WireMessage) => msg.type === "run_done";

function cardsOf(chat: Chat): unknown[] {
  return chat.events.events
    .filter((msg) => msg.type === "permission_request")
    .map((msg) => msg.callId);
}

describe("held calls, per conversation", () => {
  it(
    "asks before a repeat the DMS runs on its conversation's hold, after another conversation ran the same call (fails a hold the chat keeps for the whole sidecar)",
    async () => {
      dir = await mkdtemp(join(tmpdir(), "dms-ai-held-per-conversation-"));
      CLAUDE_FIXTURE.use("plain");
      harness = await startWsHarness({ provider: "claude" });
      const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
      const coreCall = (session: string, id: string): ScriptedCall => {
        const refusal = gate.hold(session, "builder_delete_resource", ARGS);
        const answer =
          refusal === undefined
            ? { text: '{"ok":true}', isError: false }
            : { text: joinedText(refusal), isError: true };
        return { id, name: DELETE, input: ARGS, answer };
      };
      const aFirst = coreCall("session-a", "a-first");
      const bFirst = coreCall("session-b", "b-first");
      const aRepeat = coreCall("session-a", "a-repeat");
      const bRepeat = coreCall("session-b", "b-repeat");
      expect([aRepeat.answer?.isError, bRepeat.answer?.isError]).toEqual([
        false,
        false,
      ]);
      const a = await startChat("conv-a", [aFirst, aRepeat], () => false);
      const aCard = await a.events.next(cardFor("a-repeat"));
      const b = await startChat(
        "conv-b",
        [bFirst, PAUSE, bRepeat],
        (msg) => msg.callId !== PAUSE.id,
      );
      const pauseCard = await b.events.next(cardFor(PAUSE.id));
      answerPermission(a.socket, aCard, PERMISSION_DECISIONS.ALLOW_ONCE);
      await a.events.next(isRunDone);
      answerPermission(b.socket, pauseCard, PERMISSION_DECISIONS.ALLOW_ONCE);
      await b.events.next(isRunDone);
      expect(cardsOf(a)).toEqual(["a-repeat"]);
      expect(cardsOf(b)).toEqual(["b-pause", "b-repeat"]);
    },
    TEST_TIMEOUT_MS,
  );
});
