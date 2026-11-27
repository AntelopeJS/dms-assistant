import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import { z } from "zod";
import { NAVIGATE_TOOL_NAME } from "../../src/constants/mcp.js";
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
  type WsHarness,
  waitForHandled,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 3;
const SETTLE_MS = 250;
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
  await waitForHandled(socket, client.frames);
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

  it(
    "waits for the conversation owner's host, not another person's on the same page (fails a navigation keyed by path alone or by no one)",
    async () => {
      CLAUDE_FIXTURE.use("plain");
      const running = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
      harness = running;
      const services = requireValue(running.bridge.services);
      const camille = await tabOn(running, CAMILLE, "/orders");
      const dana = await tabOn(running, DANA, "/customers");
      sendWire(camille.socket, { type: "hello", role: "host" });
      await askOn(camille, CAMILLE_CONVERSATION);
      const commanded = camille.frames.next(
        (msg) => msg.type === "host_command_navigate",
      );
      let isDone = false;
      const navigation = navigateAs(services, CAMILLE_CONVERSATION, "/sales");
      void navigation.finally(() => {
        isDone = true;
      });
      await commanded;
      await reportLanding(dana, "/sales");
      await new Promise((done) => setTimeout(done, SETTLE_MS));
      expect(isDone).toBe(false);
      await reportLanding(camille, "/sales");
      await expect(navigation).resolves.toBe("completed");
    },
    TEST_TIMEOUT_MS,
  );
});

const NavigateResult = z.object({
  content: z.tuple([z.object({ text: z.string() })]),
});

const NavigateAnswer = z.object({
  data: z.object({ navigation: z.enum(["completed", "timeout"]) }),
});

/** Calls the conversation's `navigate_to_page` tool as its agent does; answers how it ended. */
async function navigateAs(
  services: SidecarServices,
  conversationId: string,
  path: string,
): Promise<"completed" | "timeout"> {
  const client = new McpClient({ name: "per-owner-page", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await services
    .createMcpServer(conversationId)
    .instance.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = NavigateResult.parse(
      await client.callTool({ name: NAVIGATE_TOOL_NAME, arguments: { path } }),
    );
    return NavigateAnswer.parse(JSON.parse(result.content[0].text)).data
      .navigation;
  } finally {
    await client.close();
  }
}

/** The tab's host reports landing on `path`, and the sidecar has handled it. */
async function reportLanding(client: Client, path: string): Promise<void> {
  sendWire(client.socket, { type: "host_navigation_complete", path });
  await waitForHandled(client.socket, client.frames);
}
