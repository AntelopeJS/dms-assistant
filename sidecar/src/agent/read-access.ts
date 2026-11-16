import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { READ_ONLY_TOOL_PATH_KEYS } from "../constants/read-access.js";
import { readStringArg, type ToolArgs } from "./edit-targets.js";

/**
 * The roots under which read-only file tools are auto-allowed: the host project
 * plus the on-disk location of every loaded module. The module paths come from
 * `@antelopejs/interface-core` (GetModuleInfo.localPath) and are passed in at
 * spawn — we never guess where modules live.
 */
export function resolveReadRoots(
  hostProjectRoot: string,
  moduleRoots: readonly string[],
): string[] {
  const roots = new Set<string>([resolve(hostProjectRoot)]);
  for (const moduleRoot of moduleRoots) {
    if (moduleRoot.length > 0) roots.add(resolve(moduleRoot));
  }
  return [...roots];
}

const HOME_PREFIX = "~/";

/** A tool's path argument as the CLI opens it: trimmed, with `~` expanded. */
export function asTheCliReadsIt(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  return trimmed.startsWith(HOME_PREFIX)
    ? join(homedir(), trimmed.slice(HOME_PREFIX.length))
    : trimmed;
}

const GLOB_TOOL_NAME = "Glob";
const GLOB_PATTERN_KEY = "pattern";
const GLOB_SYNTAX = /[*?[\]{}]/;

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

interface ReadPathArg {
  managed: boolean;
  value: string | undefined;
}

function readPathArg(toolName: string, input: ToolArgs): ReadPathArg {
  const key = READ_ONLY_TOOL_PATH_KEYS.get(toolName);
  if (key === undefined) return { managed: false, value: undefined };
  return { managed: true, value: readStringArg(input, key) };
}

/** The directory an absolute Glob pattern lists, up to its first glob segment. */
function absolutePatternDirectory(
  toolName: string,
  input: ToolArgs,
): string | undefined {
  if (toolName !== GLOB_TOOL_NAME) return undefined;
  const pattern = readStringArg(input, GLOB_PATTERN_KEY);
  if (pattern === undefined) return undefined;
  const expanded = asTheCliReadsIt(pattern);
  if (!isAbsolute(expanded)) return undefined;
  const segments = expanded.split(sep);
  const firstGlob = segments.findIndex((segment) => GLOB_SYNTAX.test(segment));
  const literal = firstGlob === -1 ? segments : segments.slice(0, firstGlob);
  return literal.join(sep) || sep;
}

/**
 * True when `toolName` is a read-only file tool whose every target resolves
 * inside one of the allowed roots, read as the CLI reads it. A missing/blank
 * path means the tool targets the project cwd (e.g. Glob/Grep with no `path`),
 * which is in-scope. A Glob whose pattern is absolute also targets that
 * pattern's directory. `..` segments are collapsed by resolve(), so they can't
 * escape a root.
 */
export function isAutoAllowedRead(
  toolName: string,
  input: ToolArgs,
  roots: string[],
  cwd: string,
): boolean {
  const { managed, value } = readPathArg(toolName, input);
  if (!managed) return false;
  const path = value === undefined ? "" : asTheCliReadsIt(value);
  const targets = [
    path.length === 0 ? cwd : resolve(cwd, path),
    absolutePatternDirectory(toolName, input),
  ].flatMap((target) => (target === undefined ? [] : [resolve(target)]));
  return targets.every((target) =>
    roots.some((root) => isWithin(root, target)),
  );
}
