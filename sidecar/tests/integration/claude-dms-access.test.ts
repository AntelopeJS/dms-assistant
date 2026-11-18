import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import type {
  AppSettings,
  GenerationMode,
} from "../../src/state/settings-types.js";
import {
  CLAUDE_FIXTURE,
  readClaudeTrace,
  traceInto,
  type TracedClaudeEntry,
} from "../helpers/provider-fixtures.js";

const CONVERSATION = "conv-dms-access";
const TURN_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

describe("the access a Claude chat starts its DMS MCP with", () => {
  let dir: string;
  let traceFile: string;
  let runner: AgentRunner | undefined;
  let settings: AppSettings;

  function startRunner(generationMode: GenerationMode): void {
    settings = { ...DEFAULT_SETTINGS, generationMode };
    runner = createAgentRunner(
      createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS }),
      { settings },
    );
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-dms-access-"));
    traceFile = join(dir, "trace.jsonl");
    CLAUDE_FIXTURE.use("simple");
    traceInto(CLAUDE_FIXTURE.name, traceFile);
    setBuilderAvailable(true);
  });

  afterEach(async () => {
    await runner?.dispose();
    runner = undefined;
    setBuilderAvailable(false);
    CLAUDE_FIXTURE.reset();
    await rm(dir, { recursive: true, force: true });
  });

  async function sendTurn(): Promise<void> {
    if (runner === undefined) throw new Error("no runner");
    for await (const _event of runner.start("go", {
      conversationId: CONVERSATION,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    })) {
    }
  }

  function flipTo(generationMode: GenerationMode): void {
    settings = { ...settings, generationMode };
    runner?.applySettings(settings);
  }

  function sessions(): TracedClaudeEntry[] {
    return readClaudeTrace(traceFile).filter(
      (entry) => entry.kind === "session",
    );
  }

  function accessOf(session: TracedClaudeEntry | undefined): string[] {
    return (session?.mcpServers?.dms?.args ?? []).filter((arg) =>
      arg.startsWith("--access="),
    );
  }

  it(
    "starts the DMS MCP of a Safe chat with Safe access and that of a Code chat with full access (fails a Safe chat whose DMS MCP serves builder_configure_project or builder_delete_resource)",
    async () => {
      startRunner("safe");
      await sendTurn();
      await runner?.dispose();
      startRunner("vibe");
      await sendTurn();

      expect(sessions().map(accessOf)).toEqual([
        ["--access=safe"],
        ["--access=full"],
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "restarts the DMS MCP with the new access when the chat flips between Safe and Code, on a query that resumes the conversation (fails a Code chat left on Safe access, or a Safe chat left on full access)",
    async () => {
      startRunner("safe");
      await sendTurn();
      flipTo("vibe");
      await sendTurn();
      flipTo("safe");
      await sendTurn();

      expect(sessions().map(accessOf)).toEqual([
        ["--access=safe"],
        ["--access=full"],
        ["--access=safe"],
      ]);
      expect(sessions()[2]?.resume).toMatch(/^mock-session-/);
      expect(Object.keys(sessions()[2]?.mcpServers ?? {}).sort()).toEqual(
        Object.keys(sessions()[0]?.mcpServers ?? {}).sort(),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
