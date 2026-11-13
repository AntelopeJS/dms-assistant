export const PROJECT_MCP_JSON_FILE_NAME = ".mcp.json";
export const PREVIOUS_VERSION_MCP_SERVER_KEY = "dms-ai";
export const PREVIOUS_VERSION_MCP_LAUNCHER =
  "node_modules/.cache/dms-ai/mcp-bridge.cjs";
/** The server `@antelopejs/dms` adds to `.mcp.json`, as it writes it. */
export const DMS_MCP_SERVER_KEY = "dms";
/** The launcher `@antelopejs/dms` writes under the project root, unless it refuses to write the bridge. */
export const DMS_MCP_LAUNCHER = "node_modules/.cache/dms/mcp-bridge.cjs";
export const DMS_MCP_SERVER_ENTRY = {
  command: "node",
  args: [DMS_MCP_LAUNCHER],
};
export const DMS_PACKAGE_NAME = "@antelopejs/dms";
/** The width oxfmt and Prettier print a project's JSON to. */
export const MCP_JSON_PRINT_WIDTH = 80;
export const MCP_JSON_INDENT = 2;
