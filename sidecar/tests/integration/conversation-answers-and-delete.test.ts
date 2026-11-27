import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import type { SidecarServices } from "../../src/server/services.js";
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
  type WireMessage,
  type WsHarness,
  waitForHandled,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 4;
const CAMILLE = { userId: "u-camille", name: "Camille" };
const DANA = { userId: "u-dana", name: "Dana" };
const CAMILLE_CONVERSATION = "conv-camille";
const REFUSAL = "This conversation belongs to someone else.";
const QUESTION = {
  question: "Which table?",
  header: "Table",
  options: [
    { label: "orders", description: "The orders table" },
    { label: "customers", description: "The customers table" },
  ],
};

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

interface PausedTurn {
  running: WsHarness;
  services: SidecarServices;
  camille: Client;
  request: WireMessage;
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

/** Camille's turn, paused on a permission prompt for her conversation. */
async function pausedTurn(): Promise<PausedTurn> {
  CLAUDE_FIXTURE.use("permission");
  const running = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
  harness = running;
  const services = requireValue(running.bridge.services);
  const camille = await connect(running, CAMILLE);
  sendHello(camille.socket, CAMILLE_CONVERSATION);
  const prompted = camille.frames.next(
    (msg) => msg.type === "permission_request",
  );
  sendUserMessage(camille.socket, CAMILLE_CONVERSATION, "run it");
  return { running, services, camille, request: await prompted };
}

function refusalTo(client: Client): Promise<WireMessage> {
  return client.frames.next(
    (msg) => msg.type === "run_error" && msg.error === REFUSAL,
  );
}

/** The frames the server sends the client in answer to what `act` sends, echo replies left out. */
async function repliesTo(
  client: Client,
  act: () => void,
): Promise<WireMessage[]> {
  const before = client.frames.events.length;
  act();
  await waitForHandled(client.socket, client.frames);
  return client.frames.events
    .slice(before)
    .filter((msg) => msg.type !== "echo_reply");
}

function registerAnswerCases(): void {
  it.each(["allow_once", "allow_rule"] as const)(
    "drops another person's %s answer to a pending permission with no reply, as for an unknown request (fails an answer resolved by request id alone, or a refusal that tells the request exists)",
    async (decision) => {
      const { running, services, request } = await pausedTurn();
      const dana = await connect(running, DANA);
      const answer = {
        type: "permission_response",
        conversationId: "anything",
        requestId: String(request.requestId),
        decision,
      };
      const toReal = await repliesTo(dana, () =>
        sendWire(
          dana.socket,
          decision === "allow_rule"
            ? { ...answer, rule: requireValue(request.ruleOptions?.[0]) }
            : answer,
        ),
      );
      const toUnknown = await repliesTo(dana, () =>
        sendWire(dana.socket, { ...answer, requestId: "no-such-request" }),
      );
      expect(toReal).toEqual(toUnknown);
      expect(toReal).toEqual([]);
      expect(
        services.permissionBus.getPendingForConversation(CAMILLE_CONVERSATION),
      ).toHaveLength(1);
      expect(services.permissionBus.listRules(CAMILLE_CONVERSATION)).toEqual(
        [],
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "drops another person's answer to a pending question with no reply (fails an answer resolved by request id alone, or a refusal that tells the request exists)",
    async () => {
      const { running, services } = await pausedTurn();
      void services.questionBus.requestQuestion({
        conversationId: CAMILLE_CONVERSATION,
        questions: [QUESTION],
      });
      const [pending] =
        services.questionBus.getPendingForConversation(CAMILLE_CONVERSATION);
      const dana = await connect(running, DANA);
      const replies = await repliesTo(dana, () =>
        sendWire(dana.socket, {
          type: "question_response",
          conversationId: "anything",
          requestId: requireValue(pending).requestId,
          answers: ["orders"],
        }),
      );
      expect(replies).toEqual([]);
      expect(services.questionBus.countPending(CAMILLE_CONVERSATION)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );
}

function registerPausedTurnCases(): void {
  it(
    "leaves the owner's queued item and paused turn alone when another person sends queue_clear and interrupt_turn (fails a refusal that runs after the action)",
    async () => {
      const { running, services, camille } = await pausedTurn();
      sendWire(camille.socket, {
        type: "queue_enqueue",
        conversationId: CAMILLE_CONVERSATION,
        item: { id: "item-1", content: "then this" },
      });
      await camille.frames.next((msg) => msg.type === "queue_state");
      const dana = await connect(running, DANA);
      for (const type of ["queue_clear", "interrupt_turn"] as const) {
        const refused = refusalTo(dana);
        sendWire(dana.socket, { type, conversationId: CAMILLE_CONVERSATION });
        await refused;
      }
      expect(services.pendingQueue.get(CAMILLE_CONVERSATION)).toHaveLength(1);
      expect(
        services.permissionBus.getPendingForConversation(CAMILLE_CONVERSATION),
      ).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps a conversation deleted during its turn deleted (fails a turn that writes it back with no owner)",
    async () => {
      const { running, services, camille } = await pausedTurn();
      const ended = camille.frames.next(
        (msg) =>
          (msg.type === "run_done" || msg.type === "run_error") &&
          msg.conversationId === CAMILLE_CONVERSATION,
      );
      sendWire(camille.socket, {
        type: "delete_conversation",
        conversationId: CAMILLE_CONVERSATION,
      });
      await ended;
      await services.conversationStore.flush();
      expect(running.conversationStore.get(CAMILLE_CONVERSATION)).toBeNull();
      expect(running.conversationStore.list(DANA.userId)).toEqual([]);
      expect(running.conversationStore.closure(CAMILLE_CONVERSATION)).toBe(
        "deleted",
      );
    },
    TEST_TIMEOUT_MS,
  );
}

function registerEarlySocketCase(): void {
  it(
    "stops sending a turn to another person's socket that opened the id before the conversation existed (fails a check made only at hello)",
    async () => {
      CLAUDE_FIXTURE.use("plain");
      const running = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
      harness = running;
      const dana = await connect(running, DANA);
      sendHello(dana.socket, CAMILLE_CONVERSATION);
      await waitForHandled(dana.socket, dana.frames);
      const before = dana.frames.events.length;
      const camille = await connect(running, CAMILLE);
      sendHello(camille.socket, CAMILLE_CONVERSATION);
      sendUserMessage(camille.socket, CAMILLE_CONVERSATION, "camille's turn");
      await camille.frames.next((msg) => msg.type === "run_done");
      expect(
        dana.frames.events
          .slice(before)
          .filter((msg) => msg.conversationId === CAMILLE_CONVERSATION),
      ).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
}

describe("another person's answers, and a conversation deleted mid-turn", () => {
  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets = [];
    await harness?.close();
    harness = undefined;
  });

  registerAnswerCases();
  registerPausedTurnCases();
  registerEarlySocketCase();
});
