import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, matchesGlob, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRunner } from "../../src/agent/runner.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  NO_SHELL_NOTICES,
  SHELL_TOOL_NAMES,
} from "../../src/constants/shell-sandbox.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import {
  type SandboxHost,
  shellAccess,
} from "../../src/providers/claude/shell-sandbox.js";
import { createTestBus } from "../helpers/permission-bus.js";
import { readClaudeTrace } from "../helpers/provider-fixtures.js";

const ROOT = "/work/app";
const SCRIPTS = resolve(import.meta.dirname, "../fixtures/mock-claude/scripts");
const TEST_TIMEOUT_MS = 30_000;

function host(platform: string, programs: string[] = []): SandboxHost {
  return { platform, hasProgram: (program) => programs.includes(program) };
}

const LINUX_WITH_SANDBOX = host("linux", ["bwrap", "socat"]);

function deniedPaths(access: ReturnType<typeof shellAccess>): string[] {
  return access.kind === "sandboxed"
    ? (access.sandbox.filesystem?.denyRead ?? [])
    : [];
}

const isDenied = (globs: string[], path: string) =>
  globs.some((glob) => matchesGlob(path, glob));

describe("whether Claude's shell commands run in a sandbox", () => {
  it.each([
    ["macOS", host("darwin")],
    ["Linux with bubblewrap and socat", LINUX_WITH_SANDBOX],
  ])("sandboxes them on %s", (_, machine) => {
    expect(shellAccess(machine, ROOT).kind).toBe("sandboxed");
  });

  it.each([
    ["windows", host("win32", ["bwrap", "socat"])],
    ["missingLinuxPrograms", host("linux", ["socat"])],
    ["missingLinuxPrograms", host("linux", ["bwrap"])],
    ["platform", host("freebsd", ["bwrap", "socat"])],
  ])(
    "withholds the shell, for %s, where no sandbox runs",
    (reason, machine) => {
      expect(shellAccess(machine, ROOT)).toEqual({ kind: "noShell", reason });
    },
  );

  /** Fails on a sandbox that lets a command run outside it, or that starts unsandboxed when it cannot run. */
  it("never runs a command outside the sandbox", () => {
    const access = shellAccess(LINUX_WITH_SANDBOX, ROOT);
    expect(access).toMatchObject({
      kind: "sandboxed",
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        autoAllowBashIfSandboxed: false,
      },
    });
  });

  it.each([
    join(ROOT, ".env"),
    join(ROOT, ".ENV.Local"),
    join(ROOT, "apps", "site", ".env.production"),
  ])("denies reading %s inside the sandbox", (path) => {
    expect(
      isDenied(deniedPaths(shellAccess(LINUX_WITH_SANDBOX, ROOT)), path),
    ).toBe(true);
  });

  it.each([
    join(ROOT, ".env.example"),
    join(ROOT, "src", "index.ts"),
    "/elsewhere/.env",
  ])("leaves %s readable inside the sandbox", (path) => {
    expect(
      isDenied(deniedPaths(shellAccess(LINUX_WITH_SANDBOX, ROOT)), path),
    ).toBe(false);
  });
});

describe("the options a Claude session starts with, by sandbox", () => {
  let dir: string;
  let traceFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-shell-sandbox-"));
    traceFile = join(dir, "trace.jsonl");
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_TRACE = traceFile;
    process.env.MOCK_CLAUDE_SCRIPT = resolve(SCRIPTS, "read-only-command.json");
  });

  afterEach(async () => {
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
    delete process.env.MOCK_CLAUDE_TRACE;
    await rm(dir, { recursive: true, force: true });
  });

  async function startedSession(machine: SandboxHost) {
    const provider = createClaudeProvider({ timeoutMs: 10_000 }, machine);
    const runner = createAgentRunner(provider, { settings: DEFAULT_SETTINGS });
    const { bus } = createTestBus({ timeoutMs: 100 });
    try {
      for await (const _event of runner.start("go", {
        conversationId: "conv-sandbox",
        hostProjectRoot: dir,
        getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
        permissionBus: bus,
      })) {
        continue;
      }
    } finally {
      await runner.dispose();
    }
    return readClaudeTrace(traceFile).find((entry) => entry.kind === "session");
  }

  it(
    "hands the CLI the sandbox and keeps the shell where the sandbox runs",
    async () => {
      const session = await startedSession(LINUX_WITH_SANDBOX);
      expect(session?.sandbox).toMatchObject({
        enabled: true,
        allowUnsandboxedCommands: false,
      });
      expect(session?.disallowedTools).not.toContain("Bash");
    },
    TEST_TIMEOUT_MS,
  );

  /** Fails on a fallback that runs commands unsandboxed, or withholds the shell without telling the agent why. */
  it(
    "withholds every shell tool and tells the agent why where no sandbox runs",
    async () => {
      const session = await startedSession(host("win32"));
      expect(session?.sandbox).toBeUndefined();
      expect(session?.disallowedTools).toEqual(
        expect.arrayContaining([...SHELL_TOOL_NAMES]),
      );
      expect(
        session?.systemPromptAppend?.endsWith(NO_SHELL_NOTICES.windows),
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
