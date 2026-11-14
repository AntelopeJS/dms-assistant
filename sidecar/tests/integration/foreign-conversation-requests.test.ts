import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openChat,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WireCollector,
  type WsHarness,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 3;
const CAMILLE = { userId: "u-camille", name: "Camille" };
const DANA = { userId: "u-dana", name: "Dana" };
const CAMILLE_CONVERSATION = "conv-camille";
const REFUSAL = "This conversation belongs to someone else.";

/** Every chat request that acts on one conversation, as Dana sends it on Camille's. */
const FOREIGN_REQUESTS = [
  { type: "set_conversation_mode", mode: "plan", generationMode: "vibe" },
  { type: "queue_cancel", id: "item-1" },
  { type: "queue_update", id: "item-1", content: "changed" },
  { type: "queue_move", id: "item-1", toIndex: 0 },
  { type: "queue_clear" },
  { type: "revoke_rule", ruleId: "rule-1" },
  { type: "interrupt_turn" },
  { type: "stop_autofix" },
] as const;

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

let harness: WsHarness | undefined;
let sockets: WebSocket[] = [];

async function connect(
  running: WsHarness,
  actor: typeof CAMILLE,
): Promise<Client> {
  const socket = await openChat(running.port);
  sockets.push(socket);
  const client = { socket, frames: createCollector(socket, WAIT_MS) };
  sendWire(socket, { type: "actor", ...actor });
  return client;
}

describe("a chat request on another person's conversation", () => {
  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets = [];
    await harness?.close();
    harness = undefined;
  });

  it.each(FOREIGN_REQUESTS)(
    "refuses $type like a message (fails a handler that skips the ownership check)",
    async (request) => {
      CLAUDE_FIXTURE.use("plain");
      const running = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
      harness = running;
      const camille = await connect(running, CAMILLE);
      sendHello(camille.socket, CAMILLE_CONVERSATION);
      sendUserMessage(
        camille.socket,
        CAMILLE_CONVERSATION,
        "camille's request",
      );
      await camille.frames.next((msg) => msg.type === "run_done");
      const before = structuredClone(
        running.conversationStore.get(CAMILLE_CONVERSATION),
      );
      const dana = await connect(running, DANA);
      const refused = dana.frames.next(
        (msg) => msg.type === "run_error" && msg.error === REFUSAL,
      );
      sendWire(dana.socket, {
        ...request,
        conversationId: CAMILLE_CONVERSATION,
      });
      await refused;
      expect(running.conversationStore.get(CAMILLE_CONVERSATION)).toEqual(
        before,
      );
    },
    TEST_TIMEOUT_MS,
  );
});
