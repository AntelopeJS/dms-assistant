import type { StoredState } from "../state/types.js";

export const STATE_DEBOUNCE_MS = 500;
export const STATE_FILE_NAME = "state.json";
export const STATE_LOG_PREFIX = "[dms-assistant sidecar state]";

export const STATE_INITIAL: StoredState = { conversations: {} };

/** How long a deleted conversation's id stays refused: 30 days. */
export const DELETED_ID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const STATE_FILE_ENCODING = "utf8" as const;
export const STATE_JSON_INDENT = 2;
