import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import { runTurnWithHealing } from "../../src/server/turns.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openChat,
  requireValue,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WireCollector,
  type WsHarness,
  waitForHandled,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 3;
const CAMILLE = { userId: "u-camille", name: "Camille" };
const CONVERSATION = "conv-camille";
const DELETED_NOTICE =
  "This conversation was deleted. Start a new conversation.";

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

let harness: WsHarness | undefined;
let sockets: WebSocket[] = [];

async function connect(running: WsHarness): Promise<Client> {
  const socket = await openChat(running.port);
  sockets.push(socket);
  const client = { socket, frames: createCollector(socket, WAIT_MS) };
  sendWire(socket, { type: "actor", ...CAMILLE });
  return client;
}

/** Camille's conversation after one finished turn, then deleted by her. */
async function deletedConversation(): Promise<WsHarness> {
  CLAUDE_FIXTURE.use("plain");
  const running = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
  harness = running;
  const camille = await connect(running);
  sendHello(camille.socket, CONVERSATION);
  sendUserMessage(camille.socket, CONVERSATION, "camille's request");
  await camille.frames.next((msg) => msg.type === "run_done");
  sendWire(camille.socket, {
    type: "delete_conversation",
    conversationId: CONVERSATION,
  });
  await waitForHandled(camille.socket, camille.frames);
  return running;
}

describe("a deleted conversation", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.close();
    sockets = [];
    await harness?.close();
    harness = undefined;
  });

  it(
    "starts no turn, an auto-fix included, and stops its auto-fix (fails a turn pipeline that opens a session under a deleted id)",
    async () => {
      const running = await deletedConversation();
      const services = requireValue(running.bridge.services);
      expect(services.turns.isAutoFixStopped(CONVERSATION)).toBe(true);
      const start = vi.spyOn(services.runner, "start");
      await runTurnWithHealing(services, {
        conversationId: CONVERSATION,
        content: "fix it",
        request: "fix it",
        isAutoFix: true,
      });
      expect(start).not.toHaveBeenCalled();
      expect(running.conversationStore.get(CONVERSATION)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "tells a chat that opens it, at hello, that it was deleted (fails a hello that registers silently)",
    async () => {
      const running = await deletedConversation();
      const reopened = await connect(running);
      const closed = reopened.frames.next(
        (msg) => msg.type === "conversation_closed",
      );
      sendHello(reopened.socket, CONVERSATION);
      expect(await closed).toMatchObject({
        conversationId: CONVERSATION,
        message: DELETED_NOTICE,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
