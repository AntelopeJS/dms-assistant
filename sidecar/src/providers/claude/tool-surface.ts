import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { effectiveGenerationMode } from "../../builder/capability.js";
import {
  SAFE_MODE_HIDDEN_CLI_TOOLS,
  SAFE_MODE_HIDDEN_EDIT_TOOLS,
  UNSERVED_CLI_TOOLS,
} from "../../constants/claude.js";
import type { TurnSettings } from "../../state/settings-types.js";
import { resolvePermissionMode, resolveModelOptions } from "./config.js";
import { createInputQueue } from "./input-queue.js";
import { DMS_MCP_SERVER_KEY } from "../../constants/mcp.js";
import { type DmsMcpAccess, dmsMcpAccessFor } from "../../mcp/dms-server.js";
import { dmsMcpServer, HIDDEN_DMS_MCP_TOOLS } from "./mcp-servers.js";
import type { LoadedSdk } from "./sdk-loader.js";
import type { StreamBackend } from "./session-stream.js";

/**
 * The built-in tools these settings keep out of the model's sight. In Safe
 * scope every command and notebook edit is refused, and so is every file edit
 * but the plan file that Plan only writes, so the model is not offered them:
 * it would only try them and read the refusal. The safe-mode hook still
 * refuses the call of a tool that slips through. Code mode hides nothing.
 */
export function hiddenToolsFor(settings: TurnSettings): readonly string[] {
  if (effectiveGenerationMode(settings.generationMode) !== "safe") return [];
  if (settings.mode === "plan") return SAFE_MODE_HIDDEN_CLI_TOOLS;
  return [...SAFE_MODE_HIDDEN_CLI_TOOLS, ...SAFE_MODE_HIDDEN_EDIT_TOOLS];
}

/** Every tool a session's `disallowedTools` names: the ones the chat never serves, and the ones these settings hide. */
export function disallowedToolsFor(settings: TurnSettings): string[] {
  return [
    ...HIDDEN_DMS_MCP_TOOLS,
    ...UNSERVED_CLI_TOOLS,
    ...hiddenToolsFor(settings),
  ];
}

/**
 * What a query fixes when it starts and a flip of the settings can change:
 * the built-in tools it hides, and the access its DMS MCP server runs with.
 */
export interface ToolSurface {
  hiddenTools: readonly string[];
  dmsAccess: DmsMcpAccess;
}

/** The surface a query in these settings starts with. */
export function toolSurfaceFor(settings: TurnSettings): ToolSurface {
  return {
    hiddenTools: hiddenToolsFor(settings),
    dmsAccess: dmsMcpAccessFor(settings),
  };
}

function isSameToolSurface(left: ToolSurface, right: ToolSurface): boolean {
  return (
    left.dmsAccess === right.dmsAccess &&
    left.hiddenTools.length === right.hiddenTools.length &&
    left.hiddenTools.every((name) => right.hiddenTools.includes(name))
  );
}

/** The backend of a session whose query a change of its tool surface starts again. */
export interface SurfaceBackend extends StreamBackend {
  sdk: LoadedSdk;
  /** The options the running query started with, the base of a rebuilt one. */
  options: Options;
  /** The surface the running query started with, which a flip of the settings can change. */
  surface: ToolSurface;
  /** The idle release closed the query: the next turn starts one again. */
  isReleased: boolean;
  /** Where the DMS MCP launcher of a rebuilt query is found. */
  hostProjectRoot: string;
}

/**
 * Closes the CLI of an idle session, which ends its process. The conversation
 * lives on in the CLI's own session: `syncToolSurface` starts a query that
 * resumes it at the next turn. A session with no session id yet has nothing to
 * resume, so its CLI stays.
 */
export function releaseIdleQuery(backend: SurfaceBackend): void {
  if (backend.sessionId === null || backend.isReleased) return;
  backend.isReleased = true;
  backend.queue.close();
  backend.output.close();
}

/**
 * Starts the query again when the idle release closed it, and when the surface
 * the live settings give is not the one the running query started with: the
 * CLI fixes its tool list and its MCP servers when it starts, so a flip of
 * Safe mode or Plan only takes effect on the turn that follows, on a query
 * that resumes the same conversation, with the DMS MCP restarted at the new
 * access. Called between turns, so nothing in flight is lost.
 */
export function syncToolSurface(backend: SurfaceBackend): void {
  const settings = backend.live.settings;
  const surface = toolSurfaceFor(settings);
  if (!backend.isReleased && isSameToolSurface(surface, backend.surface))
    return;
  const previous = backend.queue;
  const queue = createInputQueue();
  const base = {
    ...backend.options,
    ...resolveModelOptions(settings),
    permissionMode: resolvePermissionMode(settings),
    disallowedTools: disallowedToolsFor(settings),
    mcpServers: {
      ...backend.options.mcpServers,
      [DMS_MCP_SERVER_KEY]: dmsMcpServer(
        backend.hostProjectRoot,
        surface.dmsAccess,
      ),
    },
  };
  const options =
    backend.sessionId === null ? base : { ...base, resume: backend.sessionId };
  backend.output = backend.sdk.query({ prompt: queue.stream, options });
  backend.queue = queue;
  backend.options = options;
  backend.surface = surface;
  backend.isReleased = false;
  previous.close();
  if (backend.model.refused !== null) {
    void backend.output.setModel(undefined).catch(() => undefined);
  }
}
