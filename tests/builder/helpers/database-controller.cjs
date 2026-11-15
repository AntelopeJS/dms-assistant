const path = require("node:path");
const { loadModule } = require("./load-module.cjs");

const CONTROLLER = path.resolve(
  __dirname,
  "../../../dist/builder/routes/database.js",
);

class HTTPResult {
  /**
   * @param {number} status
   * @param {unknown} body
   */
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}

/**
 * @typedef {(...args: unknown[]) => Promise<unknown>} Handler
 * @typedef {{ verb: string, path: string, key: string | symbol, handler: Handler }} Route
 * @typedef {"owner" | "body" | `${string}:${string}`} Reads
 * @typedef {{ key: string | symbol, index: number, reads: Reads }} Param
 */

/**
 * @param {unknown} exported
 * @returns {exported is { DatabaseController: (new () => object) & { prefix: string } }}
 */
function exposesController(exported) {
  return (
    typeof exported === "object" &&
    exported !== null &&
    "DatabaseController" in exported &&
    typeof exported.DatabaseController === "function" &&
    "prefix" in exported.DatabaseController &&
    typeof exported.DatabaseController.prefix === "string"
  );
}

const SERVED = {
  ok: true,
  data: { modules: ["dms"], self: "dms", databasePins: [], drivers: {} },
  changes: [],
};

/**
 * @param {Record<string, unknown>} core
 * @param {string} [projectPath] The project the runtime reports.
 */
function loadDatabaseController(core, projectPath = "/nonexistent-project") {
  /** @type {Route[]} */
  const routes = [];
  /** @type {Param[]} */
  const params = [];
  /** @param {string} verb */
  const verbOf =
    (verb) =>
    (/** @type {string} */ routePath) =>
    (
      /** @type {object} */ _target,
      /** @type {string | symbol} */ key,
      /** @type {TypedPropertyDescriptor<Handler>} */ descriptor,
    ) => {
      if (descriptor.value) {
        routes.push({ verb, path: routePath, key, handler: descriptor.value });
      }
    };
  /** @param {Reads} reads */
  const paramOf =
    (reads) =>
    (
      /** @type {object} */ _target,
      /** @type {string | symbol} */ key,
      /** @type {number} */ index,
    ) => {
      params.push({ key, index, reads });
    };
  const { DatabaseController } = loadModule(
    CONTROLLER,
    {
      "@antelopejs/interface-api": {
        Controller: (/** @type {string} */ prefix) =>
          class {
            static prefix = prefix;
          },
        Get: verbOf("GET"),
        Post: verbOf("POST"),
        HTTPResult,
        JSONBody: () => paramOf("body"),
        Parameter: (/** @type {string} */ name, /** @type {string} */ source) =>
          paramOf(`${source}:${name}`),
      },
      "@antelopejs/interface-core/runtime": {
        GetRuntimeInfo: async () => ({ projectPath, dev: true }),
      },
      "@antelopejs/interface-dms/guards": {
        AuthTenantOwner: () => paramOf("owner"),
      },
      "@antelopejs/interface-dms-builder": {
        GetDatabaseProject: async () => SERVED,
        ...core,
      },
    },
    exposesController,
  );
  const controller = new DatabaseController();
  /** @param {string | symbol} key */
  const readsOf = (key) =>
    params
      .filter((param) => param.key === key)
      .toSorted((a, b) => a.index - b.index)
      .map((param) => param.reads);
  return {
    prefix: DatabaseController.prefix,
    /** Every route the controller binds, by verb and path, with what each reads in argument order. */
    routes: () =>
      routes.map(({ verb, path: routePath, key }) => ({
        verb,
        path: routePath,
        reads: readsOf(key),
      })),
    /**
     * @param {string} verb
     * @param {string} routePath
     */
    route(verb, routePath) {
      const bound = routes.filter(
        (entry) => entry.verb === verb && entry.path === routePath,
      );
      if (bound.length !== 1) {
        throw new Error(
          `${bound.length} routes are bound to ${verb} ${routePath}`,
        );
      }
      const [{ key, handler }] = bound;
      return {
        reads: readsOf(key),
        /** @param {unknown[]} args */
        call: (...args) => handler.apply(controller, args),
      };
    },
  };
}

module.exports = { HTTPResult, loadDatabaseController };
