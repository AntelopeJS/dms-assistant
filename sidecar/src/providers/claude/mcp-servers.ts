import type { McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import {
  DMS_MCP_HIDDEN_TOOL_NAMES,
  DMS_MCP_SERVER_KEY,
  DMS_MCP_TOOL_NAME_PREFIX,
  MCP_SERVER_KEY,
} from "../../constants/mcp.js";
import { type DmsMcpAccess, dmsMcpLaunch } from "../../mcp/dms-server.js";
import type { AiMcpServer } from "../../mcp/types.js";

/** The `mcpServers` option of a session. */
export type PromptMcpServers = NonNullable<Options["mcpServers"]>;

/** The DMS MCP server of a session, started over its launcher with the chat's access. */
export function dmsMcpServer(
  hostProjectRoot: string,
  access: DmsMcpAccess,
): McpServerConfig {
  return { type: "stdio", ...dmsMcpLaunch(hostProjectRoot, access) };
}

/**
 * The MCP servers of a session: the DMS's, started with the chat's access, and
 * the chat's own when it has one.
 */
export function buildMcpServersMap(
  mcpServer: AiMcpServer | undefined,
  hostProjectRoot: string,
  access: DmsMcpAccess,
): PromptMcpServers {
  const dms = dmsMcpServer(hostProjectRoot, access);
  if (mcpServer === undefined) return { [DMS_MCP_SERVER_KEY]: dms };
  return { [DMS_MCP_SERVER_KEY]: dms, [MCP_SERVER_KEY]: mcpServer };
}

/** The DMS MCP tools the session hides from the agent. */
export const HIDDEN_DMS_MCP_TOOLS = DMS_MCP_HIDDEN_TOOL_NAMES.map(
  (name) => `${DMS_MCP_TOOL_NAME_PREFIX}${name}`,
);
