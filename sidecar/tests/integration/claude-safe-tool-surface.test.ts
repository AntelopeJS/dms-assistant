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

const CONVERSATION = "conv-safe-tool-surface";
const SAFE_HIDDEN = ["Bash", "Write", "Edit", "NotebookEdit"];
const TURN_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

describe("the tools a Claude session shows by generation mode", () => {
  let dir: string;
  let traceFile: string;
  let runner: AgentRunner | undefined;
  let settings: AppSettings;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-tool-surface-"));
    traceFile = join(dir, "trace.jsonl");
    CLAUDE_FIXTURE.use("simple");
    traceInto(CLAUDE_FIXTURE.name, traceFile);
    setBuilderAvailable(true);
    settings = { ...DEFAULT_SETTINGS, generationMode: "safe" };
    runner = createAgentRunner(
      createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS }),
      { settings },
    );
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

  it(
    "starts a Safe session without Bash, Write, Edit and NotebookEdit (fails a Safe session that shows the model a tool the safe-mode hook then refuses)",
    async () => {
      await sendTurn();

      expect(sessions()).toHaveLength(1);
      expect(sessions()[0]?.disallowedTools).toEqual(
        expect.arrayContaining(SAFE_HIDDEN),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "starts a Code session with all of them (fails a Code session that loses a tool)",
    async () => {
      flipTo("vibe");

      await sendTurn();

      expect(sessions()).toHaveLength(1);
      for (const name of SAFE_HIDDEN) {
        expect(sessions()[0]?.disallowedTools).not.toContain(name);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "gives a conversation that leaves Safe mode its tools back on the next turn, on a query that resumes it (fails a Code conversation that started in Safe and stays without Bash, or one that forgets what was said)",
    async () => {
      await sendTurn();
      flipTo("vibe");
      await sendTurn();

      const [first, second] = sessions();
      expect(sessions()).toHaveLength(2);
      expect(first?.resume).toBeUndefined();
      expect(second?.resume).toMatch(/^mock-session-/);
      for (const name of SAFE_HIDDEN) {
        expect(second?.disallowedTools).not.toContain(name);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "hides them again when a Code conversation turns Safe (fails a flip to Safe that leaves the tools in front of the model)",
    async () => {
      flipTo("vibe");
      await sendTurn();
      flipTo("safe");
      await sendTurn();

      expect(sessions()).toHaveLength(2);
      expect(sessions()[1]?.disallowedTools).toEqual(
        expect.arrayContaining(SAFE_HIDDEN),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps one query while the mode stays as it is (fails a restart on every turn)",
    async () => {
      await sendTurn();
      await sendTurn();

      expect(sessions()).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
