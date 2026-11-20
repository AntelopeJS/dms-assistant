import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { IDLE_PROCESS_RELEASE_MS } from "../../src/constants/agent.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import {
  SCRIPT_SESSION_ID,
  writeClaudeScript,
} from "../helpers/claude-scripts.js";
import { flushCallbacks } from "../helpers/deferred.js";
import {
  CLAUDE_FIXTURE,
  readClaudeTrace,
  type TracedClaudeEntry,
} from "../helpers/provider-fixtures.js";

const CONVERSATION_ID = "conv-idle-release";
/** The mock CLI's pause between two messages. */
const STREAM_STEP_MS = 5;
const ONE_SECOND_MS = 1_000;
/** Far past any fake time a turn takes, so the turn's own idle timeout never fires. */
const TURN_TIMEOUT_MS = 24 * 60 * 60_000;
const TEST_TIMEOUT_MS = 30_000;

const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  generationMode: "vibe",
  defaultModes: { ...DEFAULT_SETTINGS.defaultModes, claude: "normal" },
};

const ScriptedMessages = z.array(z.record(z.string(), z.unknown()));

/** Rewrites a scripted turn so none of its messages carries a CLI session id. */
async function stripSessionIds(script: string): Promise<void> {
  const messages = ScriptedMessages.parse(
    JSON.parse(await readFile(script, "utf8")),
  );
  await writeFile(
    script,
    JSON.stringify(
      messages.map(({ session_id: _sessionId, ...message }) => message),
    ),
  );
}

/**
 * Moves the fake clock one stream step at a time until `work` settles, and
 * lets the file and import work a turn waits on run in between.
 */
async function settleOnFakeClock(work: Promise<unknown>): Promise<void> {
  let isSettled = false;
  const markSettled = (): void => {
    isSettled = true;
  };
  void work.then(markSettled, markSettled);
  while (!isSettled) {
    await vi.advanceTimersByTimeAsync(STREAM_STEP_MS);
    await flushCallbacks();
  }
  await work;
}

interface IdleSession {
  runTurn: (onEvent?: (event: RunnerEvent) => void) => Promise<RunnerEvent[]>;
  /** The runner of the current test. */
  runner: () => AgentRunner;
  /** The scripted turn the mock CLI replays, which a test may rewrite. */
  script: () => string;
  /** How many times the CLI was closed. */
  closes: () => number;
  /** The queries started, in order, as the mock CLI traced them. */
  starts: () => TracedClaudeEntry[];
}

/**
 * Registers a Claude runner on the mock CLI, with the timers faked, on the
 * enclosing suite. A turn plays through the real provider and session.
 */
function useIdleSession(): IdleSession {
  let dir: string;
  let traceFile: string;
  let script: string;
  let runner: AgentRunner;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-idle-release-"));
    traceFile = join(dir, "trace.jsonl");
    CLAUDE_FIXTURE.use("plain");
    process.env.MOCK_CLAUDE_TRACE = traceFile;
    script = await writeClaudeScript(dir, "turn", []);
    process.env.MOCK_CLAUDE_SCRIPT = script;
    runner = createAgentRunner(
      createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS }),
      { settings: SETTINGS },
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await runner.dispose();
    CLAUDE_FIXTURE.reset();
    await rm(dir, { recursive: true, force: true });
  });

  return {
    runTurn: async (onEvent = () => {}) => {
      const events: RunnerEvent[] = [];
      await settleOnFakeClock(
        (async () => {
          for await (const event of runner.start("go", {
            conversationId: CONVERSATION_ID,
            hostProjectRoot: dir,
            getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
          })) {
            events.push(event);
            onEvent(event);
          }
        })(),
      );
      return events;
    },
    runner: () => runner,
    script: () => script,
    closes: () =>
      readClaudeTrace(traceFile).filter((entry) => entry.kind === "close")
        .length,
    starts: () =>
      readClaudeTrace(traceFile).filter((entry) => entry.kind === "session"),
  };
}

describe("a Claude session that idles between turns", () => {
  const session = useIdleSession();

  it(
    "closes its CLI once the idle window passes, and the next turn resumes the conversation by its session id (fails a session that keeps its CLI for ever, or restarts it without the id)",
    async () => {
      const first = await session.runTurn();
      expect(first.at(-1)?.type).toBe("done");
      await vi.advanceTimersByTimeAsync(IDLE_PROCESS_RELEASE_MS - 1);
      expect(session.closes()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(session.closes()).toBe(1);

      const second = await session.runTurn();
      expect(second.at(-1)?.type).toBe("done");
      expect(session.starts().map((entry) => entry.resume)).toEqual([
        undefined,
        SCRIPT_SESSION_ID,
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "counts the window from the end of the latest turn (fails a window counted from the first turn)",
    async () => {
      await session.runTurn();
      await vi.advanceTimersByTimeAsync(
        IDLE_PROCESS_RELEASE_MS - ONE_SECOND_MS,
      );
      await session.runTurn();
      await vi.advanceTimersByTimeAsync(
        IDLE_PROCESS_RELEASE_MS - ONE_SECOND_MS,
      );
      expect(session.closes()).toBe(0);
      expect(session.starts()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(ONE_SECOND_MS);
      expect(session.closes()).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "runs the next turn on the settings changed while its CLI was closed (fails a resumed query started on the settings it had before)",
    async () => {
      await session.runTurn();
      await vi.advanceTimersByTimeAsync(IDLE_PROCESS_RELEASE_MS);
      session.runner().applySettings({
        ...SETTINGS,
        defaultModes: { ...SETTINGS.defaultModes, claude: "plan" },
      });
      await session.runTurn();
      expect(session.starts().map((entry) => entry.permissionMode)).toEqual([
        "default",
        "plan",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "closes its CLI after a turn the user stopped as it does after any other (fails a stopped turn that leaves its CLI open for ever)",
    async () => {
      const events = await session.runTurn((event) => {
        if (event.type === "assistant_text") {
          session.runner().interruptSession(CONVERSATION_ID);
        }
      });
      expect(events.at(-1)?.type).toBe("done");
      await vi.advanceTimersByTimeAsync(IDLE_PROCESS_RELEASE_MS);
      expect(session.closes()).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "closes nothing of a session already disposed (fails an idle timer that outlives its session)",
    async () => {
      await session.runTurn();
      await session.runner().disposeSession(CONVERSATION_ID);
      await vi.advanceTimersByTimeAsync(IDLE_PROCESS_RELEASE_MS);
      expect(session.closes()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps the CLI of a session that never learned its session id, which a new one could not resume (fails a close that would drop the conversation's context)",
    async () => {
      await stripSessionIds(session.script());
      await session.runTurn();
      await vi.advanceTimersByTimeAsync(IDLE_PROCESS_RELEASE_MS);
      expect(session.closes()).toBe(0);
      const second = await session.runTurn();
      expect(second.at(-1)?.type).toBe("done");
      expect(session.starts()).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
