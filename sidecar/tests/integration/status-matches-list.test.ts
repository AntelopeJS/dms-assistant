import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { z } from "zod";
import { rawDataToText } from "../../src/server/raw-data.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  callApi,
  createCollector,
  openChat,
  parseWireMessage,
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
const NOTHING = {
  workingConversations: 0,
  pendingApprovals: 0,
  pendingQuestions: 0,
};
const CAMILLE_WAITS = {
  workingConversations: 1,
  pendingApprovals: 1,
  pendingQuestions: 0,
};

const ListedConversations = z.object({
  conversations: z.array(
    z.object({
      isRunning: z.boolean(),
      pendingApprovals: z.number(),
      pendingQuestions: z.number(),
    }),
  ),
});

const Status = z.object({
  status: z.string(),
  workingConversations: z.number(),
  pendingApprovals: z.number(),
  pendingQuestions: z.number(),
});

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

let harness: WsHarness | undefined;
let clients: Client[] = [];

async function startWithCamilleWaiting(): Promise<WsHarness> {
  CLAUDE_FIXTURE.use("permission");
  harness = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
  const camille = await connect(CAMILLE);
  sendHello(camille.socket, CAMILLE_CONVERSATION);
  sendUserMessage(camille.socket, CAMILLE_CONVERSATION, "go");
  await camille.frames.next((msg) => msg.type === "permission_request");
  return harness;
}

async function connect(actor?: typeof CAMILLE): Promise<Client> {
  if (harness === undefined) throw new Error("harness not started");
  const socket = await openChat(harness.port);
  const client = { socket, frames: createCollector(socket, WAIT_MS) };
  clients.push(client);
  if (actor !== undefined) sendWire(socket, { type: "actor", ...actor });
  return client;
}

/** What the conversation list the server sends the client now shows of its work. */
function listedActivity(client: Client): Promise<typeof NOTHING> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("no list")), WAIT_MS);
    const onMessage = (data: Parameters<typeof rawDataToText>[0]): void => {
      const msg = parseWireMessage(rawDataToText(data));
      if (msg.type !== "conversation_list") return;
      clearTimeout(timer);
      client.socket.off("message", onMessage);
      const { conversations } = ListedConversations.parse(msg);
      done({
        workingConversations: conversations.filter((c) => c.isRunning).length,
        pendingApprovals: conversations.reduce(
          (sum, c) => sum + c.pendingApprovals,
          0,
        ),
        pendingQuestions: conversations.reduce(
          (sum, c) => sum + c.pendingQuestions,
          0,
        ),
      });
    };
    client.socket.on("message", onMessage);
    sendWire(client.socket, { type: "list_conversations" });
  });
}

async function statusFor(viewer?: string) {
  if (harness === undefined) throw new Error("harness not started");
  const query = viewer === undefined ? "" : `?viewer=${viewer}`;
  const response = await callApi(harness.port, `/status${query}`);
  expect(response.ok).toBe(true);
  return Status.parse(await response.json());
}

describe("the sidecar's status and its conversation lists", () => {
  afterEach(async () => {
    for (const client of clients) client.socket.close();
    clients = [];
    CLAUDE_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
  });

  it(
    "tell each person the same of their own conversations while another person's turn waits (fails a status that counts turns the list hides)",
    async () => {
      await startWithCamilleWaiting();
      const camille = await connect(CAMILLE);
      const dana = await connect(DANA);

      const camilleList = await listedActivity(camille);
      expect(camilleList).toEqual(CAMILLE_WAITS);
      expect(await statusFor(CAMILLE.userId)).toEqual({
        status: "waiting",
        ...camilleList,
      });

      const danaList = await listedActivity(dana);
      expect(danaList).toEqual(NOTHING);
      expect(await statusFor(DANA.userId)).toEqual({
        status: "ready",
        ...danaList,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "answers a request that names no person as the list of a connection that named no actor (fails a status that counts every person's turns)",
    async () => {
      await startWithCamilleWaiting();
      const anonymous = await connect();

      const anonymousList = await listedActivity(anonymous);
      expect(anonymousList).toEqual(NOTHING);
      expect(await statusFor()).toEqual({
        status: "ready",
        ...anonymousList,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
