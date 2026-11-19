import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import {
  isAutoAllowedRead,
  sessionToolResultsRoot,
} from "../../src/agent/read-access.js";
import { buildSafeModeHooks } from "../../src/providers/claude/safe-mode.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

const PROJECT = "/work/app";
const PROJECT_FOLDER = "/home/me/.claude/projects/-work-app";
const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";
const TRANSCRIPT = join(PROJECT_FOLDER, `${SESSION}.jsonl`);
const SAVED_RESULT = join(
  PROJECT_FOLDER,
  SESSION,
  "tool-results",
  "toolu_01.txt",
);

describe("sessionToolResultsRoot", () => {
  it("is the tool-results folder beside the session's transcript", () => {
    expect(sessionToolResultsRoot(SESSION, TRANSCRIPT)).toBe(
      join(PROJECT_FOLDER, SESSION, "tool-results"),
    );
  });

  it("is undefined when the transcript is not the session's own", () => {
    expect(sessionToolResultsRoot(SESSION, "")).toBeUndefined();
    expect(sessionToolResultsRoot("", TRANSCRIPT)).toBeUndefined();
    expect(
      sessionToolResultsRoot(
        SESSION,
        join(PROJECT_FOLDER, SESSION, "subagents", "agent-1.jsonl"),
      ),
    ).toBeUndefined();
    expect(sessionToolResultsRoot(OTHER_SESSION, TRANSCRIPT)).toBeUndefined();
  });
});

describe("reading a saved tool result", () => {
  async function announce(
    readRoots: string[],
    sessionId: string,
    transcriptPath: string,
  ): Promise<void> {
    const hooks = buildSafeModeHooks({
      getSettings: () => TURN_SETTINGS,
      readRoots,
      hostProjectRoot: PROJECT,
    });
    const [matcher] = hooks.PreToolUse ?? [];
    const input: PreToolUseHookInput = {
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd: PROJECT,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "call-1",
      tool_input: { file_path: SAVED_RESULT },
    };
    await matcher.hooks[0](input, "call-1", {
      signal: new AbortController().signal,
    });
  }

  const read = (readRoots: string[], filePath: string): boolean =>
    isAutoAllowedRead("Read", { file_path: filePath }, readRoots, PROJECT);

  it("prompts for it before the session has announced itself", () => {
    expect(read([PROJECT], SAVED_RESULT)).toBe(false);
  });

  it("auto-allows reads in the current session's folder once the hook has run", async () => {
    const readRoots = [PROJECT];
    await announce(readRoots, SESSION, TRANSCRIPT);
    expect(read(readRoots, SAVED_RESULT)).toBe(true);
    await announce(readRoots, SESSION, TRANSCRIPT);
    expect(readRoots).toHaveLength(2);
  });

  it("keeps every other session's folder and the rest of the project folder closed", async () => {
    const readRoots = [PROJECT];
    await announce(readRoots, SESSION, TRANSCRIPT);
    expect(
      read(
        readRoots,
        join(PROJECT_FOLDER, OTHER_SESSION, "tool-results", "toolu_01.txt"),
      ),
    ).toBe(false);
    expect(read(readRoots, TRANSCRIPT)).toBe(false);
    expect(
      read(readRoots, join(PROJECT_FOLDER, SESSION, "tool-results", "..", "x")),
    ).toBe(false);
  });

  it("leaves writes to the folder to the usual prompt", async () => {
    const readRoots = [PROJECT];
    await announce(readRoots, SESSION, TRANSCRIPT);
    expect(
      isAutoAllowedRead(
        "Write",
        { file_path: SAVED_RESULT },
        readRoots,
        PROJECT,
      ),
    ).toBe(false);
  });
});
