/** The programs Claude Code's sandbox runs commands through on Linux. */
export const LINUX_SANDBOX_PROGRAMS = ["bwrap", "socat"] as const;

/** The tools that run a program the sandbox would hold, withheld when it cannot run. */
export const SHELL_TOOL_NAMES = ["Bash", "PowerShell", "Monitor"] as const;

/** Why Claude Code's sandbox cannot run on this machine. */
export type NoSandboxReason = "windows" | "missingLinuxPrograms" | "platform";

/**
 * What the agent is told when it has no shell, by reason, so it tells the
 * owner why and what would restore it.
 */
export const NO_SHELL_NOTICES: Record<NoSandboxReason, string> = {
  windows:
    "You have no shell on this machine: Claude Code cannot run shell commands in a sandbox on Windows, and outside one a command could read the project's .env values. Work with your file tools. When a step needs a command, give the owner the command to run themselves, and tell them that Codex runs commands in its own sandbox on Windows.",
  missingLinuxPrograms:
    "You have no shell on this machine: Claude Code runs shell commands in a sandbox that keeps the project's .env values out of reach, and on Linux that sandbox needs bubblewrap and socat, which are not installed. Work with your file tools. When a step needs a command, give the owner the command to run themselves, and tell them that installing bubblewrap and socat (for example `sudo apt-get install bubblewrap socat`) gives you a shell.",
  platform:
    "You have no shell on this machine: Claude Code cannot run shell commands in a sandbox on this platform, and outside one a command could read the project's .env values. Work with your file tools. When a step needs a command, give the owner the command to run themselves.",
};
