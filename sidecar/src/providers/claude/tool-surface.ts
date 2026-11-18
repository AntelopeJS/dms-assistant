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
import { HIDDEN_DMS_MCP_TOOLS } from "./mcp-servers.js";
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

function isSameToolSurface(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((name) => right.includes(name))
  );
}

/** The backend of a session whose query a change of the hidden tools starts again. */
export interface SurfaceBackend extends StreamBackend {
  sdk: LoadedSdk;
  /** The options the running query started with, the base of a rebuilt one. */
  options: Options;
  /** The built-in tools the running query hides, which a flip of the settings can change. */
  hiddenTools: readonly string[];
}

/**
 * Starts the query again with the tools the live settings hide, when they are
 * not the ones the running query hides: the CLI fixes its tool list when it
 * starts, so a flip of Safe mode or Plan only that changes it takes effect on
 * the turn that follows, on a query that resumes the same conversation. Called
 * between turns, so nothing in flight is lost.
 */
export function syncToolSurface(backend: SurfaceBackend): void {
  const settings = backend.live.settings;
  const hiddenTools = hiddenToolsFor(settings);
  if (isSameToolSurface(hiddenTools, backend.hiddenTools)) return;
  const previous = backend.queue;
  const queue = createInputQueue();
  const base = {
    ...backend.options,
    ...resolveModelOptions(settings),
    permissionMode: resolvePermissionMode(settings),
    disallowedTools: disallowedToolsFor(settings),
  };
  const options =
    backend.sessionId === null ? base : { ...base, resume: backend.sessionId };
  backend.output = backend.sdk.query({ prompt: queue.stream, options });
  backend.queue = queue;
  backend.options = options;
  backend.hiddenTools = hiddenTools;
  previous.close();
  if (backend.model.refused !== null) {
    void backend.output.setModel(undefined).catch(() => undefined);
  }
}
