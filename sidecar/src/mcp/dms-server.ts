import path from "node:path";
import { effectiveGenerationMode } from "../builder/capability.js";
import {
  DMS_MCP_ACCESS_FLAG,
  DMS_MCP_CLIENT_ARG,
  DMS_MCP_COMMAND,
  DMS_MCP_LAUNCHER_PATH,
} from "../constants/mcp.js";
import type { AppSettings } from "../state/settings-types.js";

/**
 * What the chat lets the DMS MCP run: `safe` refuses every tool the DMS
 * classes as changing the project, `full` leaves the project's own
 * `mcp.access` to decide. The DMS applies the stricter of the two.
 */
export type DmsMcpAccess = "safe" | "full";

/** The access a chat in these settings starts the DMS MCP with: `safe` exactly when the chat runs in Safe scope. */
export function dmsMcpAccessFor(settings: AppSettings): DmsMcpAccess {
  return effectiveGenerationMode(settings.generationMode) === "safe"
    ? "safe"
    : "full";
}

/** How a session starts the DMS MCP server over stdio. */
export interface DmsMcpLaunch {
  command: string;
  args: string[];
}

/**
 * The entry the DMS writes into the project's `.mcp.json`, with the launcher
 * path made absolute so a session reaches it whatever its working directory,
 * and the chat's access added. A DMS that predates the access argument ignores
 * it.
 */
export function dmsMcpLaunch(
  hostProjectRoot: string,
  access: DmsMcpAccess,
): DmsMcpLaunch {
  return {
    command: DMS_MCP_COMMAND,
    args: [
      path.join(path.resolve(hostProjectRoot), ...DMS_MCP_LAUNCHER_PATH),
      DMS_MCP_CLIENT_ARG,
      `${DMS_MCP_ACCESS_FLAG}${access}`,
    ],
  };
}
