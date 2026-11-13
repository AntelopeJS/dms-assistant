/** The project file Claude Code reads its project-scoped MCP servers from. */
export const PROJECT_MCP_JSON_FILE_NAME = ".mcp.json";
/**
 * The server the previous version of this module added to `.mcp.json`, and
 * the launcher it pointed at, which needs a bridge this version no longer
 * ships.
 */
export const STALE_MCP_SERVER_KEY = "dms-ai";
export const STALE_MCP_LAUNCHER = "node_modules/.cache/dms-ai/mcp-bridge.cjs";
/** The server `@antelopejs/dms` adds to `.mcp.json`, as it writes it. */
export const DMS_MCP_SERVER_KEY = "dms";
export const DMS_MCP_SERVER_ENTRY = {
  command: "node",
  args: ["node_modules/.cache/dms/mcp-bridge.cjs"],
};
export const DMS_PACKAGE_NAME = "@antelopejs/dms";
/** The width oxfmt and Prettier print a project's JSON to. */
export const MCP_JSON_PRINT_WIDTH = 80;
export const MCP_JSON_INDENT = 2;
