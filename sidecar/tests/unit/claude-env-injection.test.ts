import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildClaudeEnv } from "../../src/providers/claude/config.js";
import type { SavedClaudeToken } from "../../src/providers/claude/credentials.js";

const SAVED: SavedClaudeToken = {
  token: "sk-ant-oat01-saved-test-only",
  savedAt: "2026-01-01T00:00:00.000Z",
};

describe("the saved Claude token in the CLI's environment", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dms-assistant-claude-env-"));
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it("is handed over as CLAUDE_CODE_OAUTH_TOKEN when the environment has no credential", () => {
    const env = buildClaudeEnv({ PATH: "/usr/bin" }, root, () => SAVED);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SAVED.token);
  });

  it("is left out when any of the three credential variables is set", () => {
    for (const name of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
    ]) {
      const readSaved = vi.fn(() => SAVED);
      const env = buildClaudeEnv({ [name]: "from-env" }, root, readSaved);
      expect(env[name]).toBe("from-env");
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).not.toBe(SAVED.token);
      expect(readSaved).not.toHaveBeenCalled();
    }
  });

  it("adds nothing when no token is saved", () => {
    const env = buildClaudeEnv({ PATH: "/usr/bin" }, root, () => undefined);
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });
});
