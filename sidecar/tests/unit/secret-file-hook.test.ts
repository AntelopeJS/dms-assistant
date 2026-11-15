import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRE_TOOL_USE_HOOK_EVENT } from "../../src/constants/claude.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../src/constants/permissions.js";
import { SECRET_FILE_DENIED_MESSAGE } from "../../src/constants/project-secrets.js";
import { withSecretFileGuard } from "../../src/providers/claude/secret-files.js";

async function decideIn(
  dir: string,
  toolName: string,
  toolInput: Record<string, string>,
  permissionMode: PermissionMode = "default",
) {
  const matchers = withSecretFileGuard({})[PRE_TOOL_USE_HOOK_EVENT] ?? [];
  const input: HookInput = {
    hook_event_name: PRE_TOOL_USE_HOOK_EVENT,
    session_id: "session",
    transcript_path: join(dir, "transcript.jsonl"),
    tool_use_id: "toolu_1",
    tool_name: toolName,
    tool_input: toolInput,
    cwd: dir,
    permission_mode: permissionMode,
  };
  const [guard] = matchers.flatMap((matcher) => matcher.hooks);
  return guard?.(input, undefined, { signal: new AbortController().signal });
}

const DENIAL = {
  hookSpecificOutput: {
    hookEventName: PRE_TOOL_USE_HOOK_EVENT,
    permissionDecision: SDK_PERMISSION_BEHAVIOR.DENY,
    permissionDecisionReason: SECRET_FILE_DENIED_MESSAGE,
  },
};

describe("the secret file hook on links", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-secret-hook-"));
    await writeFile(join(dir, ".env"), "TOKEN=canary\n");
    await writeFile(join(dir, ".env.example"), "TOKEN=\n");
    await symlink(".env", join(dir, "config.txt"));
    await symlink(".env.example", join(dir, "template.txt"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function decide(toolName: string, toolInput: Record<string, string>) {
    return decideIn(dir, toolName, toolInput);
  }

  it.each(["file_path", "path", "notebook_path"])(
    "refuses a link to .env named by %s, with the refusal message",
    async (key) => {
      expect(await decide("Read", { [key]: "config.txt" })).toEqual(DENIAL);
    },
  );

  it("refuses a link to .env named from the home directory", async () => {
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    try {
      expect(
        await decide("Grep", { pattern: "TOKEN", path: "~/config.txt" }),
      ).toEqual(DENIAL);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets a link to .env.example through", async () => {
    expect(await decide("Read", { file_path: "template.txt" })).toEqual({
      continue: true,
    });
  });

  it("still refuses a Write to .env.local, which does not exist", async () => {
    const decision = await decide("Write", { file_path: ".env.local" });
    expect(decision).toMatchObject({
      hookSpecificOutput: { permissionDecision: SDK_PERMISSION_BEHAVIOR.DENY },
    });
  });
});

describe("the secret file hook on searches", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-secret-search-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const modes: PermissionMode[] = [
    "default",
    "acceptEdits",
    "bypassPermissions",
    "plan",
    "dontAsk",
    "auto",
  ];

  const reaching: [string, Record<string, string>][] = [
    ["Grep", { pattern: "TOKEN", path: ".env" }],
    ["Grep", { pattern: "TOKEN", path: ".env " }],
    ["Grep", { pattern: "TOKEN", path: " .env.local" }],
    ["Glob", { pattern: ".env.[lp]*" }],
    ["Grep", { pattern: "TOKEN", glob: ".env*" }],
    ["Grep", { pattern: "TOKEN", glob: "*.ts,.env.local" }],
    ["Grep", { pattern: "TOKEN", glob: "*.ts {.env,.npmrc}" }],
    ["Grep", { pattern: "TOKEN", path: ".", glob: "**/.ENV.production" }],
    ["Glob", { pattern: "**/.env*" }],
    ["Glob", { pattern: ".env" }],
    ["Glob", { pattern: "config/.env.p*" }],
    ["Glob", { pattern: ".e*", path: "." }],
  ];

  describe.each(modes)("in %s", (mode) => {
    it.each(reaching)(
      "refuses a %s whose path or glob reaches a secret file: %j",
      async (tool, input) => {
        expect(await decideIn(dir, tool, input, mode)).toEqual(DENIAL);
      },
    );

    it("refuses a Grep whose glob is too long to judge", async () => {
      const glob = `{.env,${"a".repeat(70_000)}}`;
      expect(
        await decideIn(dir, "Grep", { pattern: "TOKEN", glob }, mode),
      ).toEqual(DENIAL);
    });

    it("leaves .env and .env.* out of a Grep over a directory", async () => {
      const decision = await decideIn(
        dir,
        "Grep",
        { pattern: "TOKEN", path: ".", output_mode: "content" },
        mode,
      );
      expect(decision).toEqual({
        hookSpecificOutput: {
          hookEventName: PRE_TOOL_USE_HOOK_EVENT,
          updatedInput: {
            pattern: "TOKEN",
            path: ".",
            output_mode: "content",
            glob: "!.[eE][nN][vV] !.[eE][nN][vV].*",
          },
        },
      });
    });
  });

  it("keeps a Grep's own glob ahead of the exclusions", async () => {
    const decision = await decideIn(dir, "Grep", {
      pattern: "TOKEN",
      glob: "*.ts",
    });
    expect(decision).toMatchObject({
      hookSpecificOutput: {
        updatedInput: { glob: "*.ts !.[eE][nN][vV] !.[eE][nN][vV].*" },
      },
    });
  });

  it.each([
    ["Glob", { pattern: "**/*" }],
    ["Glob", { pattern: "**/*.ts" }],
    ["Glob", { pattern: ".env.example" }],
    ["Glob", { pattern: "src/environment.ts" }],
  ])(
    "lets a %s that reaches no secret file through: %j",
    async (tool, input) => {
      expect(await decideIn(dir, tool, input)).toEqual({ continue: true });
    },
  );

  it.each([
    ["an exclusion", { pattern: "TOKEN", glob: "!.env" }],
    ["a regex naming .env", { pattern: "\\.env", path: "src" }],
  ])("runs a Grep with %s, without the secret files", async (_, input) => {
    expect(await decideIn(dir, "Grep", input)).toMatchObject({
      hookSpecificOutput: { updatedInput: { pattern: input.pattern } },
    });
  });

  it("does not refuse a Grep whose glob names a template", async () => {
    const decision = await decideIn(dir, "Grep", {
      pattern: "TOKEN",
      glob: ".env.example",
    });
    expect(decision).toMatchObject({
      hookSpecificOutput: {
        updatedInput: { glob: ".env.example !.[eE][nN][vV] !.[eE][nN][vV].*" },
      },
    });
  });
});
