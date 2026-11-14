import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
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
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 3;
const CAMILLE = { userId: "u-camille", name: "Camille" };
const DANA = { userId: "u-dana", name: "Dana" };
const CAMILLE_CONVERSATION = "conv-camille";
const DANA_CONVERSATION = "conv-dana";

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

let harness: WsHarness | undefined;
let sockets: WebSocket[] = [];

/** A dashboard tab of `actor` showing `path`, its report handled by the sidecar. */
async function tabOn(
  running: WsHarness,
  actor: typeof CAMILLE,
  path: string,
): Promise<Client> {
  const socket = await openChat(running.port);
  sockets.push(socket);
  const client = { socket, frames: createCollector(socket, WAIT_MS) };
  sendWire(socket, { type: "actor", ...actor });
  sendWire(socket, { type: "host_state_update", currentPage: { path } });
  sendWire(socket, { type: "echo", payload: path });
  await client.frames.next((msg) => msg.type === "echo_reply");
  return client;
}

async function askOn(client: Client, conversationId: string): Promise<void> {
  sendHello(client.socket, conversationId);
  sendUserMessage(client.socket, conversationId, "what is on this page?");
  await client.frames.next((msg) => msg.type === "run_done");
}

describe("the page a turn sees", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.close();
    sockets = [];
    await harness?.close();
    harness = undefined;
  });

  it(
    "is the asker's own when two owners are on different pages (fails a page shared by the whole server)",
    async () => {
      CLAUDE_FIXTURE.use("plain");
      const running = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
      harness = running;
      const services = requireValue(running.bridge.services);
      const start = vi.spyOn(services.runner, "start");
      const camille = await tabOn(running, CAMILLE, "/orders");
      const dana = await tabOn(running, DANA, "/customers");
      await askOn(camille, CAMILLE_CONVERSATION);
      await askOn(dana, DANA_CONVERSATION);
      const pageOf = (conversationId: string) =>
        start.mock.calls
          .find(([, context]) => context.conversationId === conversationId)?.[1]
          .getCurrentPage().path;
      expect(pageOf(CAMILLE_CONVERSATION)).toBe("/orders");
      expect(pageOf(DANA_CONVERSATION)).toBe("/customers");
    },
    TEST_TIMEOUT_MS,
  );
});
