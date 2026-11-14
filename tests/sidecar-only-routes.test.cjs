const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { installRequireMocks } = require("./helpers/require-mocks.cjs");

const DIST_DIR = path.resolve(__dirname, "../dist");
const SIDECAR_TOKEN = "sidecar-service-token";
const FORBIDDEN = 403;

/**
 * The `@Parameter` bindings each route method declares, in argument order.
 * @type {Map<string | symbol, { name: string, source: string }[]>}
 */
const bindings = new Map();

/** Loads the two sidecar-only controllers with the framework's decorators recording their parameter bindings. */
function loadControllers() {
  const decorator = () => () => undefined;
  const api = {
    HTTPResult,
    /** @param {string} location */
    Controller: (location) => {
      class Base {}
      Base.location = location;
      return Base;
    },
    Get: decorator,
    /**
     * @param {string} name
     * @param {string} source
     */
    Parameter:
      (name, source) =>
      /**
       * @param {object} _target
       * @param {string | symbol} method
       * @param {number} index
       */
      (_target, method, index) => {
        const list = bindings.get(method) ?? [];
        list[index] = { name, source };
        bindings.set(method, list);
      },
  };
  /** @type {Map<string, unknown>} */
  const mocks = new Map([
    ["@antelopejs/interface-api", api],
    ["@antelopejs/interface-dms-builder", { ListPages: async () => [] }],
    ["@antelopejs/interface-dms/page", { internal: { RegisterPage: {} } }],
    ["../lifecycle/spawn-sidecar", { getSidecarToken: () => SIDECAR_TOKEN }],
  ]);
  const restoreRequire = installRequireMocks(mocks);
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.startsWith(DIST_DIR)) delete require.cache[file];
    }
    return {
      ...require("../dist/routes/logs.js"),
      ...require("../dist/routes/pages-registry.js"),
    };
  } finally {
    restoreRequire();
  }
}

const routes = loadControllers();

/**
 * A route method called the way the framework does: its first argument comes
 * from the header its `@Parameter` binding names.
 * @typedef {object} SidecarRoute
 * @property {string} path
 * @property {string} method
 * @property {(token: string | undefined) => unknown} invoke
 */

/** @type {SidecarRoute[]} */
const ROUTES = [
  {
    path: "/ai/logs",
    method: "logs",
    invoke: (token) => new routes.AILogsController().logs(token),
  },
  {
    path: "/ai/pages-registry",
    method: "pagesRegistry",
    invoke: (token) =>
      new routes.AIPagesRegistryController().pagesRegistry(token),
  },
];

/**
 * @param {SidecarRoute} route
 * @param {Record<string, string>} headers
 * @returns {Promise<unknown>}
 */
async function call(route, headers) {
  const [first] = bindings.get(route.method) ?? [];
  assert.ok(
    first !== undefined && first.source === "header",
    `${route.path} reads its first argument from a header`,
  );
  return route.invoke(headers[first.name]);
}

const REFUSED = [
  {
    why: "the retired x-dms-ai-token header",
    headers: { "x-dms-ai-token": SIDECAR_TOKEN },
  },
  { why: "no token header", headers: {} },
  { why: "a wrong token", headers: { "x-dms-assistant-token": "wrong" } },
  {
    why: "the token as a Bearer credential",
    headers: { authorization: `Bearer ${SIDECAR_TOKEN}` },
  },
];

for (const route of ROUTES) {
  void test(`${route.path} answers the sidecar's token in x-dms-assistant-token (fails a route that reads another header)`, async () => {
    const result = await call(route, {
      "x-dms-assistant-token": SIDECAR_TOKEN,
    });
    assert.ok(Array.isArray(result), "the route answers its list");
  });

  for (const { why, headers } of REFUSED) {
    void test(`${route.path} refuses ${why} with 403 (fails a route that skips or loosens the token check)`, async () => {
      const result = await call(route, headers);
      assert.ok(
        result instanceof HTTPResult,
        "the route answers an HTTP result",
      );
      assert.equal(result.getStatus(), FORBIDDEN);
    });
  }
}
