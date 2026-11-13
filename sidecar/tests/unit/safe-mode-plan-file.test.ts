import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

describe("plan mode in safe mode", () => {
  beforeAll(() => setBuilderAvailable(true));
  afterAll(() => setBuilderAvailable(false));

  const preToolUse = async (filePath: string) => {
    const { buildSafeModeHooks } =
      await import("../../src/providers/claude/safe-mode.js");
    const { homedir } = await import("node:os");
    const hooks = buildSafeModeHooks({
      getSettings: () => ({ ...TURN_SETTINGS, generationMode: "safe" }),
      readRoots: ["/project"],
      hostProjectRoot: "/project",
    });
    const [matcher] = hooks.PreToolUse ?? [];
    const input: PreToolUseHookInput = {
      session_id: "session-1",
      transcript_path: "",
      cwd: "/project",
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_use_id: "call-1",
      tool_input: {
        file_path: filePath.replace("~", homedir()),
        content: "# Plan",
      },
    };
    return matcher.hooks[0](input, "call-1", {
      signal: new AbortController().signal,
    });
  };

  it("lets the plan file through, so the plan card has the proposal", async () => {
    expect(await preToolUse("~/.claude/plans/proposal.md")).toEqual({
      continue: true,
    });
  });

  it("still refuses a write anywhere else", async () => {
    const decision = await preToolUse("/project/src/index.ts");
    expect(JSON.stringify(decision)).toContain("deny");
    const escaping = await preToolUse("~/.claude/plans/../settings.json");
    expect(JSON.stringify(escaping)).toContain("deny");
  });
});
