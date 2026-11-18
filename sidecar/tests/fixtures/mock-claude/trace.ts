import { appendFileSync } from "node:fs";
import type {
  McpServerConfig,
  Options,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type { ToolArgs } from "../../../src/agent/edit-targets.js";
import { MOCK_TRACE_ENV_VAR } from "./constants.js";

export type DecidingLayer =
  | "hook"
  | "readOnly"
  | "mode"
  | "classifier"
  | "canUseTool"
  | "none";

interface TraceEntry {
  kind: string;
  name?: string;
  input?: ToolArgs;
  model?: string;
  decidedBy?: DecidingLayer;
  isAllowed?: boolean;
  permissionMode?: PermissionMode;
  plugins?: Options["plugins"];
  skills?: Options["skills"];
  mcpServers?: Record<string, TracedMcpServer>;
  disallowedTools?: string[];
  resume?: string;
  allowedTools?: string[];
  settings?: Options["settings"];
}

interface TracedMcpServer {
  type: string;
  command?: string;
  args?: string[];
}

function traceServer(config: McpServerConfig): TracedMcpServer {
  if (!("command" in config)) return { type: config.type };
  return { type: "stdio", command: config.command, args: config.args };
}

/**
 * Appends one entry to the trace file named by the environment, if any. A trace
 * that cannot be written is swallowed: tracing is never worth failing a session
 * for, same as in the Codex mock.
 */
export function appendTrace(entry: TraceEntry): void {
  const file = process.env[MOCK_TRACE_ENV_VAR];
  if (file === undefined) return;
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {}
}

export function traceOptions(options: Options | undefined): void {
  if (options === undefined) return;
  appendTrace({
    kind: "session",
    permissionMode: options.permissionMode,
    plugins: options.plugins,
    skills: options.skills,
    mcpServers: Object.fromEntries(
      Object.entries(options.mcpServers ?? {}).map(([name, config]) => [
        name,
        traceServer(config),
      ]),
    ),
    disallowedTools: options.disallowedTools,
    resume: options.resume,
    allowedTools: options.allowedTools,
    settings: options.settings,
  });
}
