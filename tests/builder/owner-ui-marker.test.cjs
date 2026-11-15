const assert = require("node:assert/strict");
const { test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { loadDatabaseController } = require("./helpers/database-controller.cjs");

const OWNER = { _id: "owner" };
const DONE = { ok: true, data: {}, changes: [] };

/** Every route that hands core a connection target or a URL, with a body it takes and the operation it runs. */
const MARKED_ROUTES = [
  [
    "/database/connections/check",
    "CheckDatabaseConnection",
    { engine: "postgres", url: "postgres://u:p@h/db" },
  ],
  [
    "/database/connection/url",
    "SetDatabaseConnectionUrl",
    { connection: "erp", url: "postgres://u:p@h/db" },
  ],
  [
    "/database/project",
    "ConfigureProject",
    {
      steps: [],
      variables: [{ name: "DB_URL", value: "postgres://u:p@h/db" }],
    },
  ],
  [
    "/database/connections/repair",
    "RepairDatabaseConnections",
    { dryRun: false },
  ],
  [
    "/database/connection/remove",
    "RemoveDatabaseConnection",
    { connection: "erp" },
  ],
  [
    "/database/analyse",
    "AnalyseDatabase",
    { connection: "erp", module: "erp" },
  ],
  ["/database/map", "MapResources", { connection: "erp", module: "erp" }],
];

/** @param {string} operation */
function controllerRecording(operation) {
  /** @type {string[]} */
  const calls = [];
  const controller = loadDatabaseController({
    [operation]: async () => {
      calls.push(operation);
      return operation === "CheckDatabaseConnection"
        ? {
            ok: true,
            data: {
              reachable: true,
              latencyMs: 1,
              canRead: true,
              canWrite: false,
            },
            changes: [],
          }
        : DONE;
    },
  });
  return { controller, calls };
}

/** Fails on a URL-taking route that runs its operation for a request carrying the owner's session but not the assistant UI's header, as a form a page posts does. */
void test("each route that takes a database target refuses the owner's request without the assistant UI's header", async () => {
  for (const [routePath, operation, body] of MARKED_ROUTES) {
    const { controller, calls } = controllerRecording(operation);
    const answer = await controller.route("POST", routePath).call(OWNER, body);
    assert.ok(answer instanceof HTTPResult, routePath);
    assert.equal(answer.getStatus(), 403, routePath);
    assert.deepEqual(calls, [], routePath);
  }
});

/** Fails on a route that refuses the assistant's own UI, or a refusal that holds a marker value other than the one the UI sends. */
void test("each route that takes a database target runs its operation for the assistant UI's request", async () => {
  for (const [routePath, operation, body] of MARKED_ROUTES) {
    const { controller, calls } = controllerRecording(operation);
    const route = controller.route("POST", routePath);
    const wrong = await route.call(OWNER, body, "true");
    assert.equal(
      wrong instanceof HTTPResult && wrong.getStatus(),
      403,
      routePath,
    );
    await route.callAsUi(OWNER, body);
    assert.deepEqual(calls, [operation], routePath);
  }
});

/** Fails on a POST route of the controller left out of the two tests above. */
void test("the tests cover every POST route of the controller", () => {
  const posts = loadDatabaseController({})
    .routes()
    .filter((route) => route.verb === "POST")
    .map((route) => route.path);
  assert.deepEqual(
    new Set(posts),
    new Set(MARKED_ROUTES.map(([routePath]) => routePath)),
  );
  assert.equal(posts.length, MARKED_ROUTES.length);
});
