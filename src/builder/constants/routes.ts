/**
 * Fixed rather than configurable: the dashboard's database connect flow ships
 * in this package and addresses these routes through `API_PREFIX` in
 * `frontend-vue/builder/app/runtime/constants.ts`, so a per-app prefix would
 * only let the two drift.
 */
export const DEFAULT_ROUTE_PREFIX = "/api/builder";

export const ROUTES = {
  databaseConnections: "/database/connections",
  databaseConnectionsRepair: "/database/connections/repair",
  databaseConnectionsCheck: "/database/connections/check",
  databaseAnalyse: "/database/analyse",
  databaseAnalysis: "/database/analysis",
  databaseMap: "/database/map",
  databaseMapping: "/database/mapping",
  databaseProject: "/database/project",
  databaseSample: "/database/sample",
  databaseConnection: "/database/connection",
  databaseConnectionRemove: "/database/connection/remove",
  databaseConnectionUrl: "/database/connection/url",
  databaseRun: "/database/run",
} as const;

/**
 * The key the module's frontend options sit under. Mirrored as `CONFIG_KEY`
 * in `frontend-vue/builder/app/runtime/enabled.ts`.
 */
export const FRONTEND_MODULE_CONFIG_KEY = "dmsBuilder";
/**
 * Option the backend publishes in the frontend manifest so the Vue module can
 * tell an enabled builder from a stale build. Mirrored as `ENABLED_OPTION` in
 * `frontend-vue/builder/app/runtime/enabled.ts`.
 */
export const FRONTEND_MODULE_ENABLED_OPTION = "enabled";
