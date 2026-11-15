import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { SECRET_FILE_GLOBS } from "../../agent/secret-file-globs.js";

/**
 * The characters a secret file name's distinguishing character is taken
 * from. Claude Code's permission rules read a `[!...]` class as a plain
 * class, so each one is spelled out as the class of every other character.
 */
const FILE_NAME_CHARACTERS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._+@~,=#%&-";

const NEGATED_CLASS = /\[!([^\]]*)\]/g;

function withoutNegatedClasses(glob: string): string {
  return glob.replace(NEGATED_CLASS, (_, excluded: string) => {
    const kept = FILE_NAME_CHARACTERS.split("").filter(
      (character) => !excluded.includes(character),
    );
    return `[${kept.join("")}]`;
  });
}

/**
 * `Read` rules that deny every secret file, the templates left readable. The
 * CLI applies them to a file a skill pulls in with an `@` reference, which no
 * hook sees, and through a link to such a file.
 */
export const SECRET_FILE_READ_DENY_RULES: readonly string[] =
  SECRET_FILE_GLOBS.map((glob) => `Read(**/${withoutNegatedClasses(glob)})`);

/**
 * The flag settings every session starts with, so that nothing a skill
 * carries can hand the agent a `.env` value unasked, in any mode:
 * - its inline shell lines (`!` and a command in backticks) get a placeholder
 *   instead of running as the skill loads;
 * - its `hooks` frontmatter, and any settings or plugin hook, does not run;
 *   the sidecar's own hooks are SDK callbacks, which this does not reach;
 * - an `@` reference to a secret file is refused.
 */
export const SDK_SESSION_SETTINGS = {
  disableSkillShellExecution: true,
  disableAllHooks: true,
  permissions: { deny: [...SECRET_FILE_READ_DENY_RULES] },
} satisfies Exclude<Options["settings"], string | undefined>;
