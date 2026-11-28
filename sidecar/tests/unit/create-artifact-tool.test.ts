import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ArtifactSpec } from "../../src/artifacts/spec.js";
import type { ArtifactRecord } from "../../src/artifacts/types.js";
import { CREATE_ARTIFACT_TOOL_NAME } from "../../src/constants/artifacts.js";
import { buildMcpServer } from "../../src/mcp/http-binding.js";
import { buildToolDefinitions } from "../../src/mcp/tool-definitions.js";
import type { JsonValue } from "../../src/protocol/json.js";
import { buildDeps } from "../helpers/mcp-tools.js";

const HOSTILE = "<img src=x onerror=alert(1)>";

const ResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});

/** The chat's MCP server with a `create_artifact` that records what it is handed. */
function buildServerRecording(saved: ArtifactSpec[]): McpServer {
  const deps = buildDeps();
  deps.saveArtifact = (spec): ArtifactRecord => {
    saved.push(spec);
    return {
      id: `a-${saved.length}`,
      conversationId: deps.conversationId,
      agent: "claude",
      createdAtMs: 0,
      kind: "report",
      spec,
    };
  };
  return buildMcpServer(buildToolDefinitions(deps));
}

/** What the model hands the tool: a title and whatever it puts in `blocks`. */
type ToolArguments = {
  title: string;
  blocks: JsonValue[];
};

async function callTool(server: McpServer, args: ToolArguments) {
  const client = new Client({ name: "artifact-test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return ResultSchema.parse(
      await client.callTool({
        name: CREATE_ARTIFACT_TOOL_NAME,
        arguments: args,
      }),
    );
  } finally {
    await client.close();
  }
}

describe("create_artifact", () => {
  it("stores the artifact's data as given, hostile markup included as text, and answers the path that opens it", async () => {
    const saved: ArtifactSpec[] = [];
    const result = await callTool(buildServerRecording(saved), {
      title: HOSTILE,
      blocks: [
        { type: "paragraph", text: HOSTILE },
        {
          type: "kpis",
          items: [{ label: "Orders", value: 42, tone: "success" }],
        },
      ],
    });
    expect(result.isError).not.toBe(true);
    expect(saved).toEqual([
      {
        title: HOSTILE,
        blocks: [
          { type: "paragraph", text: HOSTILE },
          {
            type: "kpis",
            items: [{ label: "Orders", value: 42, tone: "success" }],
          },
        ],
      },
    ]);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("/modules/ai/artifacts?artifact=a-1");
    expect(text).toContain("Markdown link");
  });

  it("refuses an artifact with a field the schema does not name, storing nothing (fails a tool that saves what it was handed)", async () => {
    const saved: ArtifactSpec[] = [];
    const result = await callTool(buildServerRecording(saved), {
      title: "Report",
      blocks: [{ type: "paragraph", text: "ok", html: "<b>bold</b>" }],
    });
    expect(result.isError).toBe(true);
    expect(saved).toEqual([]);
  });

  it("refuses a block type it does not draw", async () => {
    const saved: ArtifactSpec[] = [];
    const result = await callTool(buildServerRecording(saved), {
      title: "Report",
      blocks: [{ type: "iframe", src: "https://example.test" }],
    });
    expect(result.isError).toBe(true);
    expect(saved).toEqual([]);
  });
});
