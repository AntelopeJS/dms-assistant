export const LOGS_PATH = "/ai/logs";
export const LOGS_FETCH_TIMEOUT_MS = 5_000;
export const LOGS_LOG_PREFIX = "[logs]";
export const LOGS_FETCH_FAILED_MESSAGE =
  "backend unreachable, log query failed";

export const LOG_LEVEL_ERROR = 40;

export const RELOAD_ERROR_CHANNELS: readonly string[] = [
  "loader.hot-reload",
  "loader.local",
  "cli.command",
];

export const HOST_LOG_SETTLE_MS = 1_500;

export const QUERY_LOGS_TOOL_NAME = "query_logs";
