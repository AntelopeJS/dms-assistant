import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { PLATFORM_WINDOWS } from "../constants/native-binary.js";
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

const MSYS_DRIVE_PATH = /^\/([a-z])\//i;

function withWindowsDrive(path: string): string {
  if (process.platform !== PLATFORM_WINDOWS) return path;
  const drive = MSYS_DRIVE_PATH.exec(path)?.[1];
  return drive === undefined
    ? path
    : `${drive.toUpperCase()}:${path.slice(2).replaceAll("/", "\\")}`;
}

/**
 * A tool's path argument as the CLI opens it: trimmed, with `~` expanded, and
 * on Windows an MSYS drive path such as `/c/Users` taken as `C:\Users`.
 */
export function asTheCliReadsIt(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  return trimmed.startsWith(HOME_PREFIX)
    ? join(homedir(), trimmed.slice(HOME_PREFIX.length))
    : withWindowsDrive(trimmed);
}

const GLOB_TOOL_NAME = "Glob";
const GLOB_PATTERN_KEY = "pattern";
const SEGMENT_SEPARATOR = /[\\/]/;
const ROOTED_PATTERN = /^(?:[\\/~]|[A-Za-z]:)/;
const PARENT_SEGMENT = "..";

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

function segmentsOf(path: string): string[] {
  return path.split(SEGMENT_SEPARATOR);
}

function hasPaddedSegment(path: string): boolean {
  return segmentsOf(path).some((segment) => segment !== segment.trim());
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

/**
 * Whether a Glob's pattern provably stays under its search directory: relative,
 * with no `..` segment and no segment padded with white space. Any other
 * pattern, an absolute or drive one included, is the person's to allow.
 */
function isPatternPlaceable(toolName: string, input: ToolArgs): boolean {
  if (toolName !== GLOB_TOOL_NAME) return true;
  const pattern = readStringArg(input, GLOB_PATTERN_KEY);
  if (pattern === undefined) return true;
  const trimmed = pattern.trim();
  if (ROOTED_PATTERN.test(trimmed) || hasPaddedSegment(trimmed)) return false;
  return !segmentsOf(trimmed).includes(PARENT_SEGMENT);
}

/**
 * True only when `toolName` is a read-only file tool that provably stays inside
 * one of the allowed roots; anything the check cannot place goes to the
 * person, so a CLI parsing detail it misses costs a question, never an unasked
 * read. A missing/blank path means the project cwd. A path is read as the CLI
 * reads it (`~` expanded, trimmed) and must have no segment padded with white
 * space; a Glob's pattern must pass {@link isPatternPlaceable}. `..` segments
 * in a path are collapsed by resolve(), so they can't escape a root.
 */
export function isAutoAllowedRead(
  toolName: string,
  input: ToolArgs,
  roots: string[],
  cwd: string,
): boolean {
  const { managed, value } = readPathArg(toolName, input);
  if (!managed || !isPatternPlaceable(toolName, input)) return false;
  const path = value === undefined ? "" : asTheCliReadsIt(value);
  if (hasPaddedSegment(path)) return false;
  const target = resolve(path.length === 0 ? cwd : resolve(cwd, path));
  return roots.some((root) => isWithin(root, target));
}
