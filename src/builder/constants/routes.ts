/**
 * Fixed rather than configurable: the builder UI ships in this package and
 * addresses these routes, so a per-app prefix would only let the two drift.
 */
export const DEFAULT_ROUTE_PREFIX = "/api/builder";

export const ROUTES = {
  status: "/status",
  catalog: "/catalog",
  pages: "/pages",
  categories: "/categories",
  category: "/category",
  page: "/page",
  pageConfigure: "/page/configure",
  blocks: "/page/blocks",
  preview: "/page/preview",
  resources: "/resources",
  resource: "/resource",
  resourceConfigure: "/resource/configure",
  fields: "/resource/fields",
  queryTemplates: "/query-templates",
  queries: "/queries",
  queryPreview: "/query-preview",
  dataSources: "/data-sources",
  tableUsage: "/tables/usage",
  pageImpact: "/page/impact",
  pageAccess: "/page/access",
  permissions: "/permissions",
  refresh: "/refresh",
  databaseConnections: "/database/connections",
  databaseAnalyse: "/database/analyse",
  databaseAnalysis: "/database/analysis",
  databaseMap: "/database/map",
  databaseMapping: "/database/mapping",
  databaseProject: "/database/project",
  databaseSample: "/database/sample",
  databaseConnection: "/database/connection",
  databaseConnectionRemove: "/database/connection/remove",
  databaseConnectionUrl: "/database/connection/url",
} as const;

/**
 * The parameter a GET of the query preview carries its query in, as JSON.
 * Mirrored in `frontend-vue/builder/app/runtime/constants.ts`.
 */
export const QUERY_PREVIEW_PARAMETER = "query";

/**
 * The key the module's frontend options sit under. Mirrored in
 * `frontend-vue/builder/dms.frontend.ts`.
 */
export const FRONTEND_MODULE_CONFIG_KEY = "dmsBuilder";
/**
 * Option the backend publishes in the frontend manifest so the Vue module can
 * tell an enabled builder from a stale build. Mirrored in
 * `frontend-vue/builder/dms.frontend.ts`.
 */
export const FRONTEND_MODULE_ENABLED_OPTION = "enabled";
