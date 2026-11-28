import { MODULE_ID, ROUTE_PREFIX } from "./module";

export const AI_MODULE_ICON = "i-ph-sparkle";
export const AI_MODULE_LANDING_PAGE = "settings";

/** Where the module's pages live in the dashboard. */
const MODULE_PAGES_PATH = "/modules/ai";

export const PAGE_IDS = {
  SETTINGS: "settings",
  PROMPTS: "prompts",
  CHANGES: "changes",
  ACTIVITY: "activity",
} as const;

export const PAGE_ORDER = {
  SETTINGS: 0,
  PROMPTS: 1,
  CHANGES: 2,
  ACTIVITY: 3,
} as const;

/** The period selector of the Activity page, which its audit log follows. */
export const ACTIVITY_PERIOD_SCOPE = "ai-activity";
/** Shared by the module's period selectors: the period follows the owner. */
export const PERIOD_REMEMBER_KEY = MODULE_ID;

/** Rows a page of the audit log holds, and each "Load more" adds. */
export const ACTIVITY_PAGE_SIZE = 25;
/** Days of the Settings › Usage chart. */
const USAGE_DAYS = 14;

/** The routes the pages read, by what they serve. */
export const PAGE_ROUTES = {
  STATUS_BANNER: `${ROUTE_PREFIX}/status/banner`,
  SIDECAR_RESTART: `${ROUTE_PREFIX}/sidecar/restart`,
  CODEX_ACCOUNT_BANNER: `${ROUTE_PREFIX}/codex/account/banner`,
  CODEX_LOGOUT: `${ROUTE_PREFIX}/codex/logout`,
  CODEX_CALLBACK: `${ROUTE_PREFIX}/codex/callback`,
  USAGE: `${ROUTE_PREFIX}/metrics/usage?days=${USAGE_DAYS}`,
  USAGE_SUMMARY: `${ROUTE_PREFIX}/metrics/usage/summary?days=${USAGE_DAYS}`,
  CHANGES: `${ROUTE_PREFIX}/changes`,
  ACTIVITY: `${ROUTE_PREFIX}/activity`,
  ACTIVITY_EXPORT: `${ROUTE_PREFIX}/activity/export.csv`,
  SETTINGS: `${ROUTE_PREFIX}/settings`,
  PROMPTS: `${ROUTE_PREFIX}/prompts`,
} as const;

/** Dashboard links between the pages. */
export const PAGE_LINKS = {
  ACTIVITY: `${MODULE_PAGES_PATH}/${PAGE_IDS.ACTIVITY}`,
  PROMPTS: `${MODULE_PAGES_PATH}/${PAGE_IDS.PROMPTS}`,
} as const;
