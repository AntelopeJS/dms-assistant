import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { buildMcpServer } from "../../src/mcp/http-binding.js";
import {
  createAiMcpServer,
  createAnalystMcpServer,
} from "../../src/mcp/sdk-binding.js";
import {
  buildAnalystToolDefinitions,
  buildToolDefinitions,
} from "../../src/mcp/tool-definitions.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function buildDeps(): AiMcpServerDeps {
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
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: { call: async () => null },
    databaseClient: { get: async () => [], post: async () => ({}) },
    analystClient: { get: async () => ({}) },
    builderEnabled: true,
    sendToHost: () => {},
    navigationCompleter: createNavigationCompleter(),
    conversationId: "conv-naming",
    requestQuestion: async () => null,
    getLastEditedFile: () => undefined,
    showPreview: () => {},
    listAttachedImages: () => [],
  };
}

interface ListedTool {
  name: string;
  title: string | undefined;
}

async function listTools(server: McpServer): Promise<ListedTool[]> {
  const client = new Client({ name: "mcp-tool-naming", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.annotations?.title,
    }));
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

function sdkServer(
  create: typeof createAiMcpServer = createAiMcpServer,
): McpServer {
  const { instance } = create(buildDeps());
  if (!isMcpServer(instance)) {
    throw new Error("the SDK server is not an McpServer");
  }
  return instance;
}

type Definitions = typeof buildToolDefinitions;

const BINDINGS: [string, Definitions, () => McpServer][] = [
  ["the Claude SDK binding", buildToolDefinitions, () => sdkServer()],
  [
    "the HTTP binding",
    buildToolDefinitions,
    () => buildMcpServer(buildToolDefinitions(buildDeps())),
  ],
  [
    "the Analyst Claude SDK binding",
    buildAnalystToolDefinitions,
    () => sdkServer(createAnalystMcpServer),
  ],
  [
    "the Analyst HTTP binding",
    buildAnalystToolDefinitions,
    () => buildMcpServer(buildAnalystToolDefinitions(buildDeps())),
  ],
];

describe.each(BINDINGS)(
  "tools served by %s",
  (_binding, definitions, build) => {
    it("lists every declared tool", async () => {
      const declared = definitions(buildDeps()).map((t) => t.name);
      const listed = await listTools(build());
      expect(listed.map((tool) => tool.name).sort()).toEqual(declared.sort());
    });

    it("names every tool in snake_case", async () => {
      const offenders = (await listTools(build()))
        .map((tool) => tool.name)
        .filter((name) => !SNAKE_CASE.test(name));
      expect(offenders).toEqual([]);
    });

    it("gives every tool a readable title other than its name", async () => {
      const offenders = (await listTools(build())).filter(
        (tool) =>
          tool.title === undefined ||
          tool.title.trim() === "" ||
          tool.title === tool.name,
      );
      expect(offenders).toEqual([]);
    });
  },
);
