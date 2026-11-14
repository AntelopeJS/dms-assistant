import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import {
  ASK_USER_TOOL_NAME,
  GET_CURRENT_PAGE_TOOL_NAME,
  MCP_SERVER_NAME,
  MCP_SERVER_TYPE_SDK,
  MCP_SERVER_VERSION,
  NAVIGATE_TOOL_NAME,
} from "../../src/constants/mcp.js";
import { FIND_PAGES_TOOL_NAME } from "../../src/constants/pages.js";
import { PREVIEW_BLOCKS_TOOL_NAME } from "../../src/constants/preview.js";
import { createAiMcpServer } from "../../src/mcp/sdk-binding.js";
import type { ImportsScanner } from "../../src/pages/imports-scanner.js";
import type { RegistryClient } from "../../src/pages/registry-client.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

function buildStubRegistry(): RegistryClient {
  return {
    getRegistry: async () => [],
    getStaleSinceMs: () => null,
    invalidate: () => {},
  };
}

function buildStubScanner(): ImportsScanner {
  return {
    scan: async () => ({ importersByFile: new Map() }),
    invalidate: () => {},
  };
}

function buildDeps() {
  return {
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    registry: buildStubRegistry(),
    scanner: buildStubScanner(),
    hostProjectRoot: "/tmp/host",
    sendToHost: () => {},
    navigationCompleter: createNavigationCompleter(),
    conversationId: "conv-test",
    requestQuestion: async () => null,
    showPreview: () => {},
    listAttachedImages: () => [],
  };
}

describe("createAiMcpServer", () => {
  it("returns an sdk-typed MCP server config with the configured name", () => {
    const server = createAiMcpServer(buildDeps());
    expect(server.type).toBe(MCP_SERVER_TYPE_SDK);
    expect(server.name).toBe(MCP_SERVER_NAME);
    expect(server.instance).toBeDefined();
  });

  it("registers the get_current_page tool", async () => {
    const server = createAiMcpServer(buildDeps());
    const listed = await listRegisteredTools(server);
    expect(listed).toContain(GET_CURRENT_PAGE_TOOL_NAME);
  });

  it("registers the find_pages_using tool", async () => {
    const server = createAiMcpServer(buildDeps());
    const listed = await listRegisteredTools(server);
    expect(listed).toContain(FIND_PAGES_TOOL_NAME);
  });

  it("registers the navigate_to_page tool", async () => {
    const server = createAiMcpServer(buildDeps());
    const listed = await listRegisteredTools(server);
    expect(listed).toContain(NAVIGATE_TOOL_NAME);
  });

  it("registers the ask_user tool", async () => {
    const server = createAiMcpServer(buildDeps());
    const listed = await listRegisteredTools(server);
    expect(listed).toContain(ASK_USER_TOOL_NAME);
  });

  it("registers the preview_blocks tool", async () => {
    const server = createAiMcpServer(buildDeps());
    const listed = await listRegisteredTools(server);
    expect(listed).toContain(PREVIEW_BLOCKS_TOOL_NAME);
  });

  it("serves only the chat's own tools (fails a server that still lists a tool the DMS MCP serves)", async () => {
    const listed = await listRegisteredTools(createAiMcpServer(buildDeps()));
    expect([...listed].sort()).toEqual([
      "ask_user",
      "find_pages_using",
      "get_current_page",
      "navigate_to_page",
      "preview_blocks",
    ]);
  });

  it("uses the configured server version metadata", async () => {
    const server = createAiMcpServer(buildDeps());
    const version = await withConnectedClient(server, async (client) => {
      return client.getServerVersion()?.version;
    });
    expect(version).toBe(MCP_SERVER_VERSION);
  });
});

function isMcpServer(
  value: ReturnType<typeof createAiMcpServer>["instance"],
): value is McpServer {
  return (
    typeof value === "object" &&
    value !== null &&
    "connect" in value &&
    typeof value.connect === "function"
  );
}

async function withConnectedClient<T>(
  server: ReturnType<typeof createAiMcpServer>,
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const { instance } = server;
  if (!isMcpServer(instance)) {
    throw new Error("the SDK server is not an McpServer");
  }
  const client = new Client({ name: "mcp-server-test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    instance.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

async function listRegisteredTools(
  server: ReturnType<typeof createAiMcpServer>,
): Promise<string[]> {
  return withConnectedClient(server, async (client) => {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  });
}
