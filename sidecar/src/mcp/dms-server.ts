import path from "node:path";
import {
  DMS_MCP_CLIENT_ARG,
  DMS_MCP_COMMAND,
  DMS_MCP_LAUNCHER_PATH,
} from "../constants/mcp.js";

/** How a session starts the DMS MCP server over stdio. */
export interface DmsMcpLaunch {
  command: string;
  args: string[];
}

/**
 * The entry the DMS writes into the project's `.mcp.json`, with the launcher
 * path made absolute so a session reaches it whatever its working directory.
 */
export function dmsMcpLaunch(hostProjectRoot: string): DmsMcpLaunch {
  return {
    command: DMS_MCP_COMMAND,
    args: [
      path.join(path.resolve(hostProjectRoot), ...DMS_MCP_LAUNCHER_PATH),
      DMS_MCP_CLIENT_ARG,
    ],
  };
}
