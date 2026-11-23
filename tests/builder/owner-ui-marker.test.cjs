const assert = require("node:assert/strict");
const { test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { loadDatabaseController } = require("./helpers/database-controller.cjs");

const OWNER = { _id: "owner" };
const DONE = { ok: true, data: {}, changes: [] };

/** Every route that takes a database URL, with a body it takes and the operation it runs. */
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

void test("each route that takes a database target refuses the owner's request without the assistant UI's header", async () => {
  for (const [routePath, operation, body] of MARKED_ROUTES) {
    const { controller, calls } = controllerRecording(operation);
    const answer = await controller.route("POST", routePath).call(OWNER, body);
    assert.ok(answer instanceof HTTPResult, routePath);
    assert.equal(answer.getStatus(), 403, routePath);
    assert.deepEqual(calls, [], routePath);
  }
});

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

void test("the URL-taking routes, and only they, read the assistant UI's header", () => {
  const reading = loadDatabaseController({})
    .routes()
    .filter((route) => route.reads.includes("header:x-dms-ui-assistant"))
    .map((route) => [route.verb, route.path].join(" "));
  assert.deepEqual(
    new Set(reading),
    new Set([
      "POST /database/connections/check",
      "POST /database/connection/url",
      "POST /database/project",
    ]),
  );
  assert.equal(reading.length, MARKED_ROUTES.length);
});
