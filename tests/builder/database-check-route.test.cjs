const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { loadModule } = require("./helpers/load-module.cjs");
const { uninstallPackages } = require("./helpers/uninstalled-packages.cjs");

const DIST = path.resolve(__dirname, "../../dist/builder");
const SECRET = `${require("node:crypto").randomBytes(4).toString("hex")}-secret`;

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
 * @typedef {{ runConnectionCheck: (body: unknown) => Promise<unknown> }} CheckRoute
 */

/**
 * @param {unknown} exported
 * @returns {exported is CheckRoute}
 */
function exposesCheck(exported) {
  return (
    typeof exported === "object" &&
    exported !== null &&
    "runConnectionCheck" in exported &&
    typeof exported.runConnectionCheck === "function"
  );
}

/**
 * The route with the core's development flag and, unless `realCheck` is set, the check itself
 * answered by a recorder.
 *
 * @param {{ dev: boolean, realCheck?: boolean }} options
 */
function loadRoute({ dev, realCheck = false }) {
  /** @type {unknown[][]} */
  const checked = [];
  /** @type {Record<string, unknown>} */
  const mocks = {
    "@antelopejs/interface-api": { HTTPResult },
    "@antelopejs/interface-core/runtime": {
      GetRuntimeInfo: async () => ({ dev }),
    },
  };
  if (!realCheck) {
    mocks["../implementations/dms-builder/engine/database-check"] = {
      checkDatabase: async (/** @type {unknown[]} */ ...args) => {
        checked.push(args);
        return { reachable: true, canRead: true, canWrite: false };
      },
    };
  }
  const { runConnectionCheck } = loadModule(
    path.join(DIST, "routes/database-check.js"),
    mocks,
    exposesCheck,
  );
  return { runConnectionCheck, checked };
}

/** Fails on a route that checks a database outside development, where `api.enabled` may mount the builder. */
void test("outside development the check answers 403 and opens no connection", async () => {
  const { runConnectionCheck, checked } = loadRoute({ dev: false });
  const answer = await runConnectionCheck({
    engine: "postgres",
    url: "postgres://u@h/db",
  });
  assert.ok(answer instanceof HTTPResult);
  assert.equal(answer.status, 403);
  assert.deepEqual(checked, []);
});

/** Fails on a route that passes a body it did not parse, whatever its engine or scheme. */
void test("a body that is not an engine and a URL of that engine answers 400, never echoing the URL", async () => {
  const { runConnectionCheck, checked } = loadRoute({ dev: true });
  const url = `postgres://u:${SECRET}@h/db`;
  const bad = [
    {},
    { engine: "postgres" },
    { url },
    { engine: "oracle", url },
    { engine: "mongodb", url },
    { engine: "postgres", url: "not a url" },
    { engine: "postgres", url: 5 },
    null,
  ];
  for (const body of bad) {
    const answer = await runConnectionCheck(body);
    assert.ok(answer instanceof HTTPResult, JSON.stringify(body));
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.equal(JSON.stringify(answer.body).includes(SECRET), false);
  }
  assert.deepEqual(checked, []);
});

/** Fails on a route that sends the check the body as it came, not as parsed, or that answers anything else. */
void test("a good body is checked as the engine it names and answers what the check found", async () => {
  const { runConnectionCheck, checked } = loadRoute({ dev: true });
  const urls = {
    postgres: "postgresql://u@h:5432/db",
    mongodb: "mongodb://u@h:27017/db",
    rethinkdb: "rethinkdb://u@h:28015/db",
  };
  for (const [engine, url] of Object.entries(urls)) {
    assert.deepEqual(await runConnectionCheck({ engine, url, extra: 1 }), {
      reachable: true,
      canRead: true,
      canWrite: false,
    });
  }
  assert.deepEqual(
    checked.map(([engine, url]) => [engine, url]),
    Object.entries(urls),
  );
});

/** Fails on a route that answers an uninstalled client with the driver's error, or not at all. */
void test("an engine whose client is not installed answers the sentence that installs it", async () => {
  const reinstall = uninstallPackages(["pg", "mongodb", "rethinkdb-ts"]);
  try {
    const { runConnectionCheck } = loadRoute({ dev: true, realCheck: true });
    const sentences = {
      postgres: "Install pg to connect a PostgreSQL database.",
      mongodb: "Install mongodb to connect a MongoDB database.",
      rethinkdb: "Install rethinkdb-ts to connect a RethinkDB database.",
    };
    for (const [engine, reason] of Object.entries(sentences)) {
      assert.deepEqual(
        await runConnectionCheck({
          engine,
          url: `${engine}://u@127.0.0.1:1/db`,
        }),
        { reachable: false, canRead: false, canWrite: false, reason },
        engine,
      );
    }
  } finally {
    reinstall();
  }
});

/**
 * @typedef {{ key: string | symbol, index: number }} Param
 * @typedef {(...args: unknown[]) => Promise<unknown>} Handler
 * @typedef {{ verb: string, path: string, key: string | symbol, handler: Handler | undefined }} Route
 */

/**
 * @param {unknown} exported
 * @returns {exported is { DatabaseController: Function & { prefix: string } }}
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

const ENGINE_IMPORTS = [
  "../implementations/dms-builder",
  "../implementations/dms-builder/engine/catalog-connection",
  "../implementations/dms-builder/engine/database-pin",
  "../implementations/dms-builder/engine/modules",
  "../implementations/dms-builder/engine/own-connections",
  "../implementations/dms-builder/engine/database-connection",
  "../implementations/dms-builder/engine/database-connection-remove",
  "../implementations/dms-builder/engine/analysis-job",
  "../implementations/dms-builder/engine/project-env",
];

/** Fails on a controller that leaves the check open to any tenant user, or binds it to another verb or path. */
void test("POST /api/builder/database/connections/check is bound to the owner guard and runs the route", async () => {
  /** @type {Route[]} */
  const routes = [];
  /** @type {Param[]} */
  const owners = [];
  /** @type {Param[]} */
  const bodies = [];
  /** @type {unknown[]} */
  const ran = [];
  /** @param {string} verb */
  const verbOf =
    (verb) =>
    (/** @type {string} */ routePath) =>
    (
      /** @type {object} */ _target,
      /** @type {string | symbol} */ key,
      /** @type {TypedPropertyDescriptor<Handler>} */ descriptor,
    ) => {
      routes.push({ verb, path: routePath, key, handler: descriptor.value });
    };
  /** @param {Param[]} into */
  const paramOf =
    (into) =>
    () =>
    (
      /** @type {object} */ _target,
      /** @type {string | symbol} */ key,
      /** @type {number} */ index,
    ) => {
      into.push({ key, index });
    };
  const { DatabaseController } = loadModule(
    path.join(DIST, "routes/database.js"),
    {
      "@antelopejs/interface-api": {
        Controller: (/** @type {string} */ prefix) =>
          class {
            static prefix = prefix;
          },
        Get: verbOf("GET"),
        Post: verbOf("POST"),
        HTTPResult,
        JSONBody: paramOf(bodies),
        Parameter: () => () => undefined,
      },
      "@antelopejs/interface-dms/guards": { AuthTenantOwner: paramOf(owners) },
      "./database-check": {
        runConnectionCheck: async (/** @type {unknown} */ body) => {
          ran.push(body);
          return { ran: true };
        },
      },
      ...Object.fromEntries(ENGINE_IMPORTS.map((name) => [name, {}])),
    },
    exposesController,
  );
  assert.equal(DatabaseController.prefix, "/api/builder");
  const served = routes.filter(
    (entry) => entry.path === "/database/connections/check",
  );
  assert.equal(served.length, 1);
  const [route] = served;
  assert.equal(route.verb, "POST");
  assert.deepEqual(
    owners.filter((param) => param.key === route.key),
    [{ key: route.key, index: 0 }],
  );
  assert.deepEqual(
    bodies.filter((param) => param.key === route.key),
    [{ key: route.key, index: 1 }],
  );
  assert.ok(route.handler, "the route binds no method");
  const body = { engine: "postgres", url: "postgres://u@h/db" };
  assert.deepEqual(await route.handler({ _id: "owner" }, body), { ran: true });
  assert.deepEqual(ran, [body]);
});
