import type {
  HookCallback,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  globReachesSecretFile,
  reachesSecretFile,
  SECRET_FILE_SEARCH_EXCLUSIONS,
} from "../../agent/project-secrets.js";
import { PRE_TOOL_USE_HOOK_EVENT } from "../../constants/claude.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../constants/permissions.js";
import {
  SEARCH_TOOL_GLOB_KEYS,
  SECRET_FILE_DENIED_MESSAGE,
} from "../../constants/project-secrets.js";
import type { SdkHooks } from "./safe-mode.js";

const SECRET_FILE_DENIAL: SyncHookJSONOutput = {
  hookSpecificOutput: {
    hookEventName: PRE_TOOL_USE_HOOK_EVENT,
    permissionDecision: SDK_PERMISSION_BEHAVIOR.DENY,
    permissionDecisionReason: SECRET_FILE_DENIED_MESSAGE,
  },
};

const NO_DECISION: SyncHookJSONOutput = { continue: true };

const GREP_TOOL_NAME = "Grep";

const optionalString = z.string().optional().catch(undefined);

const toolCallSchema = z.object({
  cwd: optionalString,
  tool_name: z.string().catch(""),
  tool_input: z
    .looseObject({
      file_path: optionalString,
      path: optionalString,
      notebook_path: optionalString,
      glob: optionalString,
      pattern: optionalString,
    })
    .default({}),
});

type ToolCall = z.infer<typeof toolCallSchema>;

const HOME_PREFIX = "~/";

function asTheCliReadsIt(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  return trimmed.startsWith(HOME_PREFIX)
    ? join(homedir(), trimmed.slice(HOME_PREFIX.length))
    : trimmed;
}

async function pathReachesSecret({
  cwd,
  tool_input,
}: ToolCall): Promise<boolean> {
  const paths = [
    tool_input.file_path,
    tool_input.path,
    tool_input.notebook_path,
  ];
  const checks = paths.map(
    async (path) =>
      path !== undefined &&
      (await reachesSecretFile(asTheCliReadsIt(path), cwd ?? process.cwd())),
  );
  return (await Promise.all(checks)).some(Boolean);
}

function searchGlob({ tool_name, tool_input }: ToolCall): string | undefined {
  const key = SEARCH_TOOL_GLOB_KEYS.get(tool_name);
  return key === undefined ? undefined : tool_input[key];
}

function globPatterns(glob: string): string[] {
  return glob
    .split(/\s+/)
    .flatMap((pattern) =>
      pattern.includes("{") && pattern.includes("}")
        ? [pattern]
        : pattern.split(","),
    )
    .filter((pattern) => pattern !== "");
}

function globReachesSecret(call: ToolCall): boolean {
  const glob = searchGlob(call);
  return glob !== undefined && globPatterns(glob).some(globReachesSecretFile);
}

function grepWithoutSecretFiles(call: ToolCall): SyncHookJSONOutput {
  const glob = [searchGlob(call), ...SECRET_FILE_SEARCH_EXCLUSIONS]
    .filter((pattern) => pattern !== undefined)
    .join(" ");
  return {
    hookSpecificOutput: {
      hookEventName: PRE_TOOL_USE_HOOK_EVENT,
      updatedInput: { ...call.tool_input, glob },
    },
  };
}

async function decide(call: ToolCall): Promise<SyncHookJSONOutput> {
  if (globReachesSecret(call) || (await pathReachesSecret(call))) {
    return SECRET_FILE_DENIAL;
  }
  return call.tool_name === GREP_TOOL_NAME
    ? grepWithoutSecretFiles(call)
    : NO_DECISION;
}

/**
 * Adds a `PreToolUse` hook that keeps the agent's tools away from secret files.
 * It refuses any tool call naming a secret file, or a link that resolves to
 * one, and a Grep or Glob whose file-name glob matches one. It leaves secret
 * files out of every other Grep, which searches a whole directory. A path is
 * read as the CLI reads it, trimmed and with a leading `~` or `~/` taken as
 * the home directory, and a call the guard throws on is refused.
 * The CLI runs hooks before its own permission mode, so the refusal holds
 * where a plain read under the project would be allowed unasked, and a hook
 * denial is final.
 */
export function withSecretFileGuard(hooks: SdkHooks): SdkHooks {
  const guard: HookCallback = async (input) => {
    const parsed = toolCallSchema.safeParse(input);
    if (!parsed.success) return NO_DECISION;
    return decide(parsed.data).catch(() => SECRET_FILE_DENIAL);
  };
  return {
    ...hooks,
    [PRE_TOOL_USE_HOOK_EVENT]: [
      ...(hooks[PRE_TOOL_USE_HOOK_EVENT] ?? []),
      { hooks: [guard] },
    ],
  };
}
