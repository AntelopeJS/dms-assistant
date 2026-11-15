import { basename } from "node:path";
import {
  DEPENDENCY_FILE_NAMES,
  GIT_HOOK_PATHS,
  MODULE_CONFIG_FILE_PATTERN,
  PROJECT_CONFIG_FILE_NAME,
  PROJECT_STATE_PATH,
  SCOPED_MODULE_CONFIG_PREFIX,
} from "../constants/permissions.js";
import { writeTarget } from "./write-target.js";

const ANY_TRAILING_SEGMENTS = "**";

const GIT_HOOK_PATTERNS = GIT_HOOK_PATHS.map((path) => path.split("/"));

function pathSegments(path: string): string[] {
  return path
    .toLowerCase()
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0);
}

function matchesAt(
  segments: readonly string[],
  parts: readonly string[],
  start: number,
): boolean {
  return parts.every((part, index) => segments[start + index] === part);
}

function isUnder(
  segments: readonly string[],
  parts: readonly string[],
): boolean {
  return segments.some(
    (_segment, start) =>
      start + parts.length < segments.length &&
      matchesAt(segments, parts, start),
  );
}

function endsWith(
  segments: readonly string[],
  parts: readonly string[],
): boolean {
  const start = segments.length - parts.length;
  return start >= 0 && matchesAt(segments, parts, start);
}

function matchesPathEnding(
  segments: readonly string[],
  pattern: readonly string[],
): boolean {
  return pattern.at(-1) === ANY_TRAILING_SEGMENTS
    ? isUnder(segments, pattern.slice(0, -1))
    : endsWith(segments, pattern);
}

/**
 * Whether `path`, resolved, is a file that makes git run code (see
 * GIT_HOOK_PATHS). Matched anywhere on disk, case-insensitively.
 */
export function isGitHookFile(path: string): boolean {
  const segments = pathSegments(path);
  return GIT_HOOK_PATTERNS.some((pattern) =>
    matchesPathEnding(segments, pattern),
  );
}

/**
 * Whether `path`, resolved, is a dependency file by its name, anywhere on disk,
 * case-insensitively.
 */
export function isDependencyFile(path: string): boolean {
  return DEPENDENCY_FILE_NAMES.has(basename(path).toLowerCase());
}

const PROJECT_STATE_PATTERN = PROJECT_STATE_PATH.split("/");

function namesProjectConfig(path: string): boolean {
  const segments = pathSegments(path);
  const name = segments.at(-1) ?? "";
  const scoped =
    segments.at(-2)?.startsWith(SCOPED_MODULE_CONFIG_PREFIX) === true &&
    name.endsWith(".json");
  return (
    name === PROJECT_CONFIG_FILE_NAME ||
    MODULE_CONFIG_FILE_PATTERN.test(name) ||
    scoped ||
    matchesPathEnding(segments, PROJECT_STATE_PATTERN)
  );
}

/**
 * Whether `path`, resolved, is a file AntelopeJS core reads a project's
 * configuration from, by its own name or through a link: `antelope.config.ts`,
 * an `antelope.*.json` merged into a module's config (a scoped module's
 * `antelope.@scope/name.json` included), or a file under `.antelope/`. Matched
 * anywhere on disk, case-insensitively. A path whose links cannot be followed
 * counts as one.
 */
export function isProjectConfigFile(path: string): boolean {
  if (namesProjectConfig(path)) return true;
  const target = writeTarget(path, process.cwd());
  return target === undefined || namesProjectConfig(target);
}
