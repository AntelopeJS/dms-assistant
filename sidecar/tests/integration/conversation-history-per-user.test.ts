import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { rawDataToText } from "../../src/server/raw-data.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openChat,
  parseWireMessage,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WireCollector,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 3;
const LEGACY = "conv-legacy";
const CAMILLE = { userId: "u-camille", name: "Camille" };
const DANA = { userId: "u-dana", name: "Dana" };
const CAMILLE_CONVERSATION = "conv-camille";
const DANA_CONVERSATION = "conv-dana";
const DANA_SECOND_CONVERSATION = "conv-dana-2";
const SHARED_CONVERSATION = "conv-shared";
const REFUSAL = "This conversation belongs to someone else.";

function isList(msg: WireMessage): boolean {
  return msg.type === "conversation_list";
}

function idsOf(msg: WireMessage): string[] {
  return (msg.conversations ?? []).flatMap((c) => (c.id ? [c.id] : []));
}

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

let harness: WsHarness | undefined;
let clients: Client[] = [];
let syncCount = 0;

async function start(): Promise<WsHarness> {
  CLAUDE_FIXTURE.use("plain");
  harness = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
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

/** Resolves once the server has handled every frame the client sent before. */
async function settle(client: Client): Promise<void> {
  syncCount += 1;
  const payload = `sync-${syncCount}`;
  sendWire(client.socket, { type: "echo", payload });
  await client.frames.next(
    (msg) => msg.type === "echo_reply" && msg.payload === payload,
  );
}

async function ask(
  client: Client,
  conversationId: string,
  content = "list",
): Promise<void> {
  sendHello(client.socket, conversationId);
  sendUserMessage(client.socket, conversationId, content);
  await settle(client);
}

/** The ids the server lists for the client when it asks now. */
function listed(client: Client): Promise<string[]> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("no list")), WAIT_MS);
    const onMessage = (data: Parameters<typeof rawDataToText>[0]): void => {
      const msg = parseWireMessage(rawDataToText(data));
      if (!isList(msg)) return;
      clearTimeout(timer);
      client.socket.off("message", onMessage);
      done(idsOf(msg));
    };
    client.socket.on("message", onMessage);
    sendWire(client.socket, { type: "list_conversations" });
  });
}

function seedLegacyConversation(running: WsHarness): void {
  running.conversationStore.appendMessage(LEGACY, {
    role: "user",
    content: "written before owners existed",
    timestampMs: 1_000,
  });
}

function registerReadCases(): void {
  it(
    "lists only the asker's own conversations (fails a list that returns every stored conversation)",
    async () => {
      await start();
      const camille = await connect(CAMILLE);
      const dana = await connect(DANA);
      await ask(camille, CAMILLE_CONVERSATION);
      await ask(dana, DANA_CONVERSATION);
      expect(await listed(camille)).toEqual([CAMILLE_CONVERSATION]);
      expect(await listed(dana)).toEqual([DANA_CONVERSATION]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps the first owner when a second person writes to the conversation (fails an owner overwritten by the latest asker)",
    async () => {
      const running = await start();
      const camille = await connect(CAMILLE);
      const dana = await connect(DANA);
      await ask(camille, SHARED_CONVERSATION);
      await ask(dana, SHARED_CONVERSATION);
      expect(running.conversationStore.get(SHARED_CONVERSATION)?.ownerId).toBe(
        CAMILLE.userId,
      );
      expect(await listed(camille)).toEqual([SHARED_CONVERSATION]);
      expect(await listed(dana)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a message into another person's conversation and leaves its transcript alone (fails when the second person's text lands in the first person's history)",
    async () => {
      const running = await start();
      const camille = await connect(CAMILLE);
      const dana = await connect(DANA);
      await ask(camille, CAMILLE_CONVERSATION, "camille's request");
      const before =
        running.conversationStore.get(CAMILLE_CONVERSATION)?.messages.length;
      const refused = dana.frames.next(
        (msg) => msg.type === "run_error" && msg.error === REFUSAL,
      );
      await ask(dana, CAMILLE_CONVERSATION, "dana's request");
      await refused;
      const after = running.conversationStore.get(CAMILLE_CONVERSATION);
      expect(after?.messages.length).toBe(before);
      expect(JSON.stringify(after?.messages)).not.toContain("dana's request");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sends no transcript of another person's conversation to a chat that opens it by id (fails when hello replays a hidden conversation)",
    async () => {
      await start();
      const camille = await connect(CAMILLE);
      await ask(camille, CAMILLE_CONVERSATION, "camille's private request");
      const dana = await connect(DANA);
      await settle(dana);
      sendHello(dana.socket, CAMILLE_CONVERSATION);
      await settle(dana);
      const seen = dana.frames.events.map((msg) => JSON.stringify(msg));
      expect(seen.some((text) => text.includes("private request"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a named person a conversation with messages and no owner (fails a record with no owner treated as everyone's)",
    async () => {
      const running = await start();
      seedLegacyConversation(running);
      const dana = await connect(DANA);
      const refused = dana.frames.next(
        (msg) => msg.type === "run_error" && msg.error === REFUSAL,
      );
      await ask(dana, LEGACY, "a follow-up");
      await refused;
      const stored = running.conversationStore.get(LEGACY);
      expect(stored?.ownerId).toBeUndefined();
      expect(JSON.stringify(stored?.messages)).not.toContain("a follow-up");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "shows a conversation with messages and no owner only to a connection that named no actor (fails a list that shows it to a named person)",
    async () => {
      const running = await start();
      seedLegacyConversation(running);
      const camille = await connect(CAMILLE);
      const anonymous = await connect();
      await ask(camille, CAMILLE_CONVERSATION);
      expect(await listed(camille)).toEqual([CAMILLE_CONVERSATION]);
      expect(await listed(anonymous)).toEqual([LEGACY]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "gives a connection with no actor no owned conversation (fails a list that treats a missing actor as everyone)",
    async () => {
      await start();
      const camille = await connect(CAMILLE);
      const anonymous = await connect();
      await ask(camille, CAMILLE_CONVERSATION);
      expect(await listed(anonymous)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
}

function registerDeleteCases(): void {
  it(
    "refuses another person's delete and keeps the conversation (fails a delete that checks no owner)",
    async () => {
      const running = await start();
      const camille = await connect(CAMILLE);
      const dana = await connect(DANA);
      await ask(camille, CAMILLE_CONVERSATION);
      sendWire(dana.socket, {
        type: "delete_conversation",
        conversationId: CAMILLE_CONVERSATION,
      });
      const refusal = await dana.frames.next((msg) => msg.type === "run_error");
      expect(refusal.error).toBe(REFUSAL);
      expect(refusal.conversationId).toBe(CAMILLE_CONVERSATION);
      expect(
        running.conversationStore.get(CAMILLE_CONVERSATION),
      ).not.toBeNull();
      expect(await listed(camille)).toEqual([CAMILLE_CONVERSATION]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a delete from a connection with no actor (fails a delete that lets an unnamed connection through)",
    async () => {
      const running = await start();
      const camille = await connect(CAMILLE);
      const anonymous = await connect();
      await ask(camille, CAMILLE_CONVERSATION);
      sendWire(anonymous.socket, {
        type: "delete_conversation",
        conversationId: CAMILLE_CONVERSATION,
      });
      await anonymous.frames.next((msg) => msg.type === "run_error");
      expect(
        running.conversationStore.get(CAMILLE_CONVERSATION),
      ).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lets the owner delete their conversation, and no named person delete one with messages and no owner (fails a delete that refuses the owner or lets anyone delete the unowned)",
    async () => {
      const running = await start();
      seedLegacyConversation(running);
      const camille = await connect(CAMILLE);
      const dana = await connect(DANA);
      await ask(camille, CAMILLE_CONVERSATION);
      sendWire(camille.socket, {
        type: "delete_conversation",
        conversationId: CAMILLE_CONVERSATION,
      });
      sendWire(dana.socket, {
        type: "delete_conversation",
        conversationId: LEGACY,
      });
      await settle(camille);
      await settle(dana);
      expect(running.conversationStore.get(CAMILLE_CONVERSATION)).toBeNull();
      expect(running.conversationStore.get(LEGACY)).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "broadcasts to each socket only the list its actor may see (fails a broadcast built from the acting socket's list)",
    async () => {
      await start();
      const camille = await connect(CAMILLE);
      const dana = await connect(DANA);
      sendWire(camille.socket, { type: "hello", role: "chat" });
      await ask(dana, DANA_CONVERSATION);
      await ask(dana, DANA_SECOND_CONVERSATION);
      const before = camille.frames.events.filter(isList).length;
      sendWire(dana.socket, {
        type: "delete_conversation",
        conversationId: DANA_SECOND_CONVERSATION,
      });
      await dana.frames.next(
        (msg) => isList(msg) && !idsOf(msg).includes(DANA_SECOND_CONVERSATION),
      );
      await settle(camille);
      const lists = camille.frames.events.filter(isList);
      expect(lists.length).toBeGreaterThan(before);
      for (const list of lists)
        expect(idsOf(list)).not.toContain(DANA_CONVERSATION);
    },
    TEST_TIMEOUT_MS,
  );
}

describe("a person's conversation history in the sidecar", () => {
  afterEach(async () => {
    for (const client of clients) client.socket.close();
    clients = [];
    CLAUDE_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
  });

  registerReadCases();
  registerDeleteCases();
});
