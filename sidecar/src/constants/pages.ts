export const REGISTRY_CACHE_TTL_MS = 30_000;
export const REGISTRY_PATH = "/ai/pages-registry";

export const SCAN_EXTENSIONS = [".vue", ".ts", ".js"] as const;
export const SCAN_IGNORE_DIRS = [
  "node_modules",
  "dist",
  ".nuxt",
  ".antelope",
  "build",
  ".output",
] as const;

export const IMPORT_REGEX_GLOBAL = /import\s+[^"']*?from\s+["']([^"']+)["']/g;

export const FIND_PAGES_TOOL_NAME = "find_pages_using";
export const FIND_PAGES_TOOL_DESCRIPTION =
  "Given a source filepath, returns the list of pages that import it (transitively via the local source tree).";

export const LIST_PAGES_TOOL_NAME = "list_pages";

export const MAX_BFS_DEPTH = 4;

export const REGISTRY_FETCH_TIMEOUT_MS = 5_000;

export const PAGES_LOG_PREFIX = "[pages]";
export const REGISTRY_STALE_FALLBACK_MESSAGE =
  "backend unreachable, serving stale registry cache";
