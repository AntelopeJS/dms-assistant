import type { SandboxSettings } from "@anthropic-ai/claude-agent-sdk";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { SECRET_FILE_GLOBS } from "../../agent/secret-file-globs.js";
import {
  PLATFORM_LINUX,
  PLATFORM_WINDOWS,
} from "../../constants/native-binary.js";
import {
  LINUX_SANDBOX_PROGRAMS,
  NO_SHELL_NOTICES,
  type NoSandboxReason,
  SHELL_TOOL_NAMES,
} from "../../constants/shell-sandbox.js";

const PLATFORM_MACOS = "darwin";

/** How Claude's shell commands run in a session: sandboxed, or not at all. */
export type ShellAccess =
  | { kind: "sandboxed"; sandbox: SandboxSettings }
  | { kind: "noShell"; reason: NoSandboxReason };

/** What the probe reads about the machine. */
export interface SandboxHost {
  platform: string;
  /** True when `program` is an executable on the PATH. */
  hasProgram: (program: string) => boolean;
}

function noSandboxReason(host: SandboxHost): NoSandboxReason | undefined {
  if (host.platform === PLATFORM_MACOS) return undefined;
  if (host.platform === PLATFORM_WINDOWS) return "windows";
  if (host.platform !== PLATFORM_LINUX) return "platform";
  return LINUX_SANDBOX_PROGRAMS.every(host.hasProgram)
    ? undefined
    : "missingLinuxPrograms";
}

/**
 * The sandbox every shell command runs in: the secret files of the project
 * unreadable at file access, whatever the command, and no command run outside
 * it. Claude Code refuses to start rather than run commands unsandboxed.
 */
export function sandboxSettings(hostProjectRoot: string): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    filesystem: {
      denyRead: SECRET_FILE_GLOBS.map((glob) =>
        join(hostProjectRoot, "**", glob),
      ),
    },
  };
}

/**
 * Whether this machine can sandbox Claude's shell commands: macOS always,
 * Linux with bubblewrap and socat on the PATH, Windows never.
 */
export function shellAccess(
  host: SandboxHost,
  hostProjectRoot: string,
): ShellAccess {
  const reason = noSandboxReason(host);
  return reason === undefined
    ? { kind: "sandboxed", sandbox: sandboxSettings(hostProjectRoot) }
    : { kind: "noShell", reason };
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The machine the sidecar runs on, its PATH read once per call. */
export function currentSandboxHost(): SandboxHost {
  const directories = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((directory) => directory !== "");
  return {
    platform: process.platform,
    hasProgram: (program) =>
      directories.some((directory) => isExecutable(join(directory, program))),
  };
}

/** The session options that carry how its shell commands run. */
interface ShellOptions {
  systemPrompt: { append: string };
  disallowedTools?: string[];
  sandbox?: SandboxSettings;
}

/**
 * `options` with Claude's shell commands sandboxed, or, where the sandbox
 * cannot run, with the shell tools withheld and the agent told why.
 */
export function withShellAccess<Options extends ShellOptions>(
  options: Options,
  access: ShellAccess,
): Options {
  if (access.kind === "sandboxed") {
    return { ...options, sandbox: access.sandbox };
  }
  return {
    ...options,
    systemPrompt: {
      ...options.systemPrompt,
      append: `${options.systemPrompt.append}\n\n${NO_SHELL_NOTICES[access.reason]}`,
    },
    disallowedTools: [...(options.disallowedTools ?? []), ...SHELL_TOOL_NAMES],
  };
}
