import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { isAutoAllowedRead } from "../../src/agent/read-access.js";
import {
  createPermissionBus,
  type PermissionBus,
} from "../../src/agent/permission-bus.js";
import { createPermissionRuleStore } from "../../src/agent/permission-rules.js";
import {
  CODEX_COMMAND_APPROVAL_METHOD,
  CODEX_FILE_CHANGE_APPROVAL_METHOD,
} from "../../src/constants/codex.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { resolvePermissionMode } from "../../src/providers/claude/config.js";
import {
  buildSafeModeHooks,
  type SdkHooks,
} from "../../src/providers/claude/safe-mode.js";
import { withSecretFileGuard } from "../../src/providers/claude/secret-files.js";
import { createCodexPermissionHandler } from "../../src/providers/codex/permissions.js";
import type {
  ChatMode,
  GenerationMode,
  TurnSettings,
} from "../../src/state/settings-types.js";
import type { Project, Verdict } from "./agent-file-access-scopes.js";

const CONVERSATION = "conv-formal";
const CALL = "call-formal";

/** How the owner's standing allow rules stand when the call arrives. */
export type Standing = "none" | "everything under the project";

function turnSettings(
  mode: ChatMode,
  generation: GenerationMode,
): TurnSettings {
  return {
    ...DEFAULT_SETTINGS,
    mode,
    generationMode: generation,
    alwaysAskDependencies: true,
    alwaysAskBlockRemoval: true,
  };
}

interface Asked {
  bus: PermissionBus;
  prompts: () => number;
}

/** A bus over the project that answers every prompt with a refusal the moment it is shown. */
function askingBus(project: Project, standing: Standing): Asked {
  let prompted = 0;
  const rules = createPermissionRuleStore();
  if (standing !== "none") {
    rules.add(CONVERSATION, { kind: "directory", value: "." });
  }
  const bus: PermissionBus = createPermissionBus({
    getPolicy: () => ({
      hostProjectRoot: project.root,
      timeoutMs: 5_000,
      alwaysAskDependencies: true,
      alwaysAskBlockRemoval: true,
    }),
    rules,
    onPromptChat: (request) => {
      prompted += 1;
      queueMicrotask(() =>
        bus.resolvePermission({
          requestId: request.requestId,
          decision: "deny",
        }),
      );
    },
  });
  return { bus, prompts: () => prompted };
}

const HOOK_DENY = "deny";
const HOOK_ASK = "ask";

const UpdatedInputSchema = z.looseObject({ glob: z.string().optional() });

interface HookReading {
  denied: boolean;
  asked: boolean;
  updatedGlob: string | undefined;
  rewritten: boolean;
}

/** The arguments of a tool call, as the tests write them. */
type CallArgs = Readonly<Record<string, string>>;

function readOutput(output: SyncHookJSONOutput, into: HookReading): void {
  const specific = output.hookSpecificOutput;
  if (specific === undefined || specific.hookEventName !== "PreToolUse") return;
  if (specific.permissionDecision === HOOK_DENY) into.denied = true;
  if (specific.permissionDecision === HOOK_ASK) into.asked = true;
  if (specific.updatedInput !== undefined) {
    into.rewritten = true;
    into.updatedGlob = UpdatedInputSchema.parse(specific.updatedInput).glob;
  }
}

async function runHooks(
  hooks: SdkHooks,
  input: Parameters<
    NonNullable<SdkHooks["PreToolUse"]>[number]["hooks"][number]
  >[0],
): Promise<HookReading> {
  const reading: HookReading = {
    denied: false,
    asked: false,
    updatedGlob: undefined,
    rewritten: false,
  };
  for (const matcher of hooks.PreToolUse ?? []) {
    for (const callback of matcher.hooks) {
      const output = await callback(input, CALL, {
        signal: new AbortController().signal,
      });
      if ("hookSpecificOutput" in output) readOutput(output, reading);
    }
  }
  return reading;
}

const EDITING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

interface ClaudeCall {
  project: Project;
  mode: ChatMode;
  generation: GenerationMode;
  tool: string;
  args: CallArgs;
  standing?: Standing;
}

async function readHooks(call: ClaudeCall): Promise<HookReading> {
  const { project, mode, generation, tool, args } = call;
  const settings = turnSettings(mode, generation);
  const hooks = withSecretFileGuard(
    buildSafeModeHooks({
      readRoots: [project.root],
      hostProjectRoot: project.root,
      getSettings: () => settings,
    }),
  );
  return runHooks(hooks, {
    hook_event_name: "PreToolUse",
    session_id: "formal",
    transcript_path: "",
    cwd: project.root,
    permission_mode: resolvePermissionMode(settings),
    tool_name: tool,
    tool_input: args,
    tool_use_id: CALL,
  });
}

async function askPerson(call: ClaudeCall): Promise<Verdict> {
  const { project, tool, args } = call;
  if (isAutoAllowedRead(tool, args, [project.root], project.root)) {
    return "silent";
  }
  const asked = askingBus(project, call.standing ?? "none");
  const outcome = await asked.bus.requestPermission({
    conversationId: CONVERSATION,
    toolName: tool,
    args,
    callId: CALL,
  });
  if (asked.prompts() > 0) return "asks";
  return outcome.isAllowed ? "silent" : "refused";
}

/**
 * What a Claude session does with one tool call: its `PreToolUse` hooks as the session builds
 * them, then, when a hook sends the call to the person, `canUseTool` over the real permission bus.
 * A call no hook settles is left to the CLI: it runs it, except that the CLI in plan mode runs no
 * edit of its own.
 */
export async function claudeVerdict(call: ClaudeCall): Promise<Verdict> {
  const reading = await readHooks(call);
  if (reading.denied) return "refused";
  if (reading.asked) return askPerson(call);
  if (reading.rewritten) return "filtered";
  if (call.mode === "plan" && EDITING_TOOLS.has(call.tool))
    return "cli-refuses";
  return "silent";
}

/** The glob a hook made the call search with, when it rewrote the call. */
export async function rewrittenGlob(
  call: ClaudeCall,
): Promise<string | undefined> {
  return (await readHooks(call)).updatedGlob;
}

/** One file Codex's patch touches. */
export interface CodexChange {
  path: string;
  kind: "add" | "update" | "delete";
  movePath?: string;
}

/**
 * What a Codex session does with one approval request: the real handler over the real permission
 * bus. A decline with no prompt is a refusal, a prompt is a question to the person, an accept
 * with no prompt runs unasked.
 */
export async function codexVerdict(options: {
  project: Project;
  mode: ChatMode;
  generation: GenerationMode;
  request: { changes: CodexChange[] } | { command: string };
  standing?: Standing;
}): Promise<Verdict> {
  const { project, mode, generation, request } = options;
  const settings = turnSettings(mode, generation);
  const asked = askingBus(project, options.standing ?? "none");
  const changes = "changes" in request ? request.changes : [];
  const handler = createCodexPermissionHandler({
    conversationId: CONVERSATION,
    permissionBus: asked.bus,
    getSettings: () => settings,
    getChanges: () =>
      changes.map((change) => ({ ...change, diff: "@@ -1 +1 @@\n-a\n+b\n" })),
    hostProjectRoot: project.root,
    moduleRoots: [],
    getPendingMcpCalls: () => [],
  });
  const response = await handler.handle(
    "command" in request
      ? {
          id: 0,
          method: CODEX_COMMAND_APPROVAL_METHOD,
          params: { itemId: CALL, command: request.command },
        }
      : {
          id: 0,
          method: CODEX_FILE_CHANGE_APPROVAL_METHOD,
          params: { itemId: CALL },
        },
  );
  if (asked.prompts() > 0) return "asks";
  const decision = "decision" in response ? response.decision : undefined;
  return decision === "accept" ? "silent" : "refused";
}
