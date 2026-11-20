/**
 * The human-readable title of every MCP tool dms-assistant serves, keyed by its
 * snake_case name. MCP clients show the title; the model calls the name.
 */
export const MCP_TOOL_TITLES = {
  get_current_page: "Get current page",
  navigate_to_page: "Navigate to page",
  find_pages_using: "Find pages using a file",
  ask_user: "Ask the user",
} as const satisfies Readonly<Record<string, string>>;

/** The snake_case name of an MCP tool dms-assistant serves. */
export type McpToolName = keyof typeof MCP_TOOL_TITLES;
