import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChatMode,
  GenerationMode,
} from "../../src/state/settings-types.js";

/** What the person and the agent see of one call: the strongest step that stopped it, or none. */
export type Verdict =
  | "refused"
  | "asks"
  | "filtered"
  | "cli-refuses"
  | "silent";

export const CLAUDE_MODES: readonly ChatMode[] = [
  "normal",
  "auto",
  "acceptEdits",
  "plan",
];

export const CODEX_MODES: readonly ChatMode[] = [
  "normal",
  "acceptEdits",
  "plan",
];

export const GENERATIONS: readonly GenerationMode[] = ["safe", "vibe"];

/** The argument key each Claude Code file tool names its path with. */
export const FILE_TOOLS: ReadonlyArray<{ tool: string; key: string }> = [
  { tool: "Read", key: "file_path" },
  { tool: "Read", key: "path" },
  { tool: "NotebookRead", key: "notebook_path" },
  { tool: "Edit", key: "file_path" },
  { tool: "Write", key: "file_path" },
  { tool: "MultiEdit", key: "file_path" },
  { tool: "NotebookEdit", key: "notebook_path" },
  { tool: "Grep", key: "path" },
  { tool: "SendUserFile", key: "file_path" },
  { tool: "NameAddedByALaterCli", key: "file_path" },
];

export const EDIT_TOOLS: ReadonlyArray<{ tool: string; key: string }> =
  FILE_TOOLS.filter(({ tool }) => /Edit$|^Write$/.test(tool));

/**
 * Where a project file lives, as the agent may name it. A target is `secret` when a call on it
 * could read or change a `.env` file, `config` when it could change a file AntelopeJS core reads
 * its configuration from.
 */
export interface Target {
  name: string;
  path: string;
  kind: "secret" | "config" | "plain";
  /** The CLI trims a path before it reads it; a Codex patch names a file by its exact name. */
  claudeOnly?: true;
}

/** Each path is relative to the project root unless it starts with the root token. */
const ROOT_TOKEN = "<root>";

export const TARGETS: readonly Target[] = [
  { name: ".env", path: ".env", kind: "secret" },
  { name: "./.env", path: "./.env", kind: "secret" },
  { name: "sub/../.env", path: "sub/../.env", kind: "secret" },
  { name: "absolute .env", path: `${ROOT_TOKEN}/.env`, kind: "secret" },
  { name: "padded .env", path: "  .env  ", kind: "secret", claudeOnly: true },
  { name: ".ENV", path: ".ENV", kind: "secret" },
  { name: ".Env.Local", path: ".Env.Local", kind: "secret" },
  { name: ".env.production", path: ".env.production", kind: "secret" },
  { name: "link to .env", path: "env-link", kind: "secret" },
  { name: "chain of links to .env", path: "env-chain", kind: "secret" },
  { name: "nested link to .env", path: "sub/link-to-root-env", kind: "secret" },
  {
    name: "link to a .env not yet written",
    path: "missing-env",
    kind: "secret",
  },
  { name: "loop of links", path: "loop-a", kind: "secret" },
  { name: "antelope.config.ts", path: "antelope.config.ts", kind: "config" },
  {
    name: "./antelope.config.ts",
    path: "./antelope.config.ts",
    kind: "config",
  },
  { name: "ANTELOPE.CONFIG.TS", path: "ANTELOPE.CONFIG.TS", kind: "config" },
  { name: "antelope.shop.json", path: "antelope.shop.json", kind: "config" },
  {
    name: "scoped module config",
    path: "antelope.@acme/db.json",
    kind: "config",
  },
  {
    name: ".antelope/state.json",
    path: ".antelope/state.json",
    kind: "config",
  },
  {
    name: "new file in .antelope/",
    path: ".antelope/cache/new.json",
    kind: "config",
  },
  { name: "link to antelope.config.ts", path: "cfg-link", kind: "config" },
  { name: "link to a config not yet written", path: "cfg-new", kind: "config" },
  {
    name: "file through a link to .antelope/",
    path: "state-dir/state.json",
    kind: "config",
  },
  { name: "plain source file", path: "src/page.ts", kind: "plain" },
  { name: ".env.example", path: ".env.example", kind: "plain" },
];

/** What a file-name glob reaches: a secret file or not. */
export const GLOBS: ReadonlyArray<{ glob: string; reachesSecret: boolean }> = [
  { glob: ".env", reachesSecret: true },
  { glob: ".env*", reachesSecret: true },
  { glob: ".env.*", reachesSecret: true },
  { glob: "**/.env", reachesSecret: true },
  { glob: "**/.env.local", reachesSecret: true },
  { glob: ".ENV*", reachesSecret: true },
  { glob: ".env.l*", reachesSecret: true },
  { glob: "{.env,package.json}", reachesSecret: true },
  { glob: "*.ts", reachesSecret: false },
  { glob: "src/**/*.ts", reachesSecret: false },
  { glob: ".env.example", reachesSecret: false },
];

/** A Grep that names no file, so it searches a whole directory. */
export const WHOLE_DIRECTORY_SEARCHES: ReadonlyArray<Record<string, string>> = [
  {},
  { path: "." },
  { path: "sub" },
  { path: ROOT_TOKEN },
  { glob: "*" },
  { glob: "**/*" },
  { glob: "*.ts" },
];

/** Commands whose effect could read a `.env` file. */
export const SECRET_READING_COMMANDS: readonly string[] = [
  "cat .env",
  "cat ./.env.local",
  "head -n 1 .env.production",
  "grep KEY .env",
  "source .env",
  "cp .env /tmp/leak",
  "sh -c 'cat .env'",
  "less .env",
];

/** Commands whose effect could change a file core reads its configuration from. */
export const CONFIG_WRITING_COMMANDS: readonly string[] = [
  "sed -i s/a/b/ antelope.config.ts",
  "echo x > antelope.shop.json",
  "tee .antelope/state.json",
];

/** The three ways a skill can pull a `.env` value in without a tool call the hooks see. */
export const SKILL_SOURCES = [
  "inline shell command",
  "@ reference",
  "hooks frontmatter",
] as const;

export interface Project {
  root: string;
}

/**
 * A scratch project: `.env` files, the files core reads its configuration from, and the links the
 * targets above name.
 */
export async function createProject(): Promise<Project> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "formal-file-access-")),
  );
  const files = {
    ".env": "KEY=secret\n",
    ".env.local": "KEY=secret\n",
    ".env.example": "KEY=\n",
    ".ENV": "KEY=secret\n",
    "antelope.config.ts": "export default {};\n",
    "antelope.shop.json": "{}\n",
    "antelope.@acme/db.json": "{}\n",
    ".antelope/state.json": "{}\n",
    "package.json": "{}\n",
    "src/page.ts": "export {};\n",
    "sub/note.md": "note\n",
  } as const;
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, name);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, text);
  }
  const links = {
    "env-link": ".env",
    "env-chain": "env-link",
    "sub/link-to-root-env": "../.env",
    "missing-env": ".env.new",
    "loop-a": "loop-b",
    "loop-b": "loop-a",
    "cfg-link": "antelope.config.ts",
    "cfg-new": "antelope.dev.json",
    "state-dir": ".antelope",
  } as const;
  for (const [name, target] of Object.entries(links)) {
    await symlink(target, join(root, name));
  }
  return { root };
}

/** `path` with the root token replaced by the project root. */
export function inProject(project: Project, path: string): string {
  return path.replace(ROOT_TOKEN, project.root);
}
