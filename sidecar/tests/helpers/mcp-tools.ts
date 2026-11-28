import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { buildMcpServer } from "../../src/mcp/http-binding.js";
import { createAiMcpServer } from "../../src/mcp/sdk-binding.js";
import { buildToolDefinitions } from "../../src/mcp/tool-definitions.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";

/** Deps for the chat's own MCP server that answer nothing. */
export function buildDeps(): AiMcpServerDeps {
  return {
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    registry: {
      getRegistry: async () => [],
      getStaleSinceMs: () => null,
      invalidate: () => {},
    },
    scanner: {
      scan: async () => ({ importersByFile: new Map() }),
      invalidate: () => {},
    },
    hostProjectRoot: "/tmp/host",
    sendToHost: () => {},
    waitForLanding: async () => null,
    conversationId: "conv-tools",
    requestQuestion: async () => null,
    saveArtifact: () => {
      throw new Error("no artifact is expected in this test");
    },
  };
}

/** The tools a server lists to an MCP client, as the model receives them. */
export async function listTools(server: McpServer): Promise<Tool[]> {
  const client = new Client({ name: "mcp-tools", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

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

function sdkServer(): McpServer {
  const { instance } = createAiMcpServer(buildDeps());
  if (!isMcpServer(instance)) {
    throw new Error("the SDK server is not an McpServer");
  }
  return instance;
}

/** The chat's MCP server through each binding: Claude's in-process one and the HTTP one Codex reaches. */
export const BINDINGS: [string, () => McpServer][] = [
  ["the Claude SDK binding", sdkServer],
  ["the HTTP binding", () => buildMcpServer(buildToolDefinitions(buildDeps()))],
];
