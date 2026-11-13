import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import type {
  PendingRequest,
  PermissionPolicy,
} from "../../src/agent/permission-bus.js";
import type { ToolCallSubject } from "../../src/agent/held-calls.js";
import type { ToolDecision } from "../../src/agent/provider.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import type { PermissionDecisionValue } from "../../src/protocol/messages.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import { type ScriptedCall, writeClaudeScript } from "./claude-scripts.js";
import { createTestBus } from "./permission-bus.js";
import {
  readClaudeTrace,
  type TracedClaudeEntry,
} from "./provider-fixtures.js";

const CONVERSATION_ID = "conv-auto-review";
const PROMPT_TIMEOUT_MS = 2_000;
const TURN_TIMEOUT_MS = 10_000;

interface TurnOptions {
  settings?: Partial<AppSettings>;
  policy?: Partial<PermissionPolicy>;
  answer?: PermissionDecisionValue;
  isHeldCall?: (call: ToolCallSubject) => boolean;
}

interface Turn {
  prompts: PendingRequest[];
  decisions: ToolDecision[];
  announced: string[];
  tools: TracedClaudeEntry[];
  sessionMode: string | undefined;
}

export type RunTurn = (
  calls: ScriptedCall[],
  options?: TurnOptions,
) => Promise<Turn>;

export interface TurnFixture {
  runTurn: RunTurn;
  projectDir: () => string;
}

/**
 * Registers the mock Claude CLI hooks on the enclosing suite. `runTurn` plays a
 * scripted turn through the Claude provider and the permission bus, and
 * `projectDir` is the host project root of the current test.
 */
export function useClaudeTurnRunner(): TurnFixture {
  let dir: string | undefined;
  let traceFile: string;
  let runner: AgentRunner | undefined;

  const projectDir = (): string => {
    if (dir === undefined) throw new Error("no test is running");
    return dir;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-auto-review-"));
    traceFile = join(dir, "trace.jsonl");
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_TRACE = traceFile;
  });

  afterEach(async () => {
    await runner?.dispose();
    runner = undefined;
    setBuilderAvailable(false);
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
    delete process.env.MOCK_CLAUDE_TRACE;
    await rm(projectDir(), { recursive: true, force: true });
  });

  async function runTurn(
    calls: ScriptedCall[],
    options: TurnOptions = {},
  ): Promise<Turn> {
    const root = projectDir();
    process.env.MOCK_CLAUDE_SCRIPT = await writeClaudeScript(
      root,
      "turn",
      calls,
    );
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      generationMode: "vibe",
      ...options.settings,
    };
    runner = createAgentRunner(
      createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS }),
      { settings },
    );
    const prompts: PendingRequest[] = [];
    const decisions: ToolDecision[] = [];
    const announced: string[] = [];
    const { bus } = createTestBus({
      timeoutMs: PROMPT_TIMEOUT_MS,
      policy: { hostProjectRoot: root, ...options.policy },
      extra: {
        onPromptChat: (request) => {
          prompts.push(request);
          bus.resolvePermission({
            requestId: request.requestId,
            decision: options.answer ?? PERMISSION_DECISIONS.ALLOW_ONCE,
          });
        },
      },
    });
    for await (const _event of runner.start("go", {
      conversationId: CONVERSATION_ID,
      hostProjectRoot: root,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      permissionBus: bus,
      onToolDecision: (decision) => decisions.push(decision),
      onToolAnnounced: (callId) => announced.push(callId),
      isHeldCall: options.isHeldCall,
    })) {
    }
    const trace = readClaudeTrace(traceFile);
    return {
      prompts,
      decisions,
      announced,
      tools: trace.filter((entry) => entry.kind === "tool"),
      sessionMode: trace.find((entry) => entry.kind === "session")
        ?.permissionMode,
    };
  }

  return { runTurn, projectDir };
}
