const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  HTTPResult,
  loadDatabaseController,
} = require("./helpers/database-controller.cjs");

const OWNER = { _id: "owner" };

/**
 * @param {unknown} answer
 */
function checkRoute(answer) {
  /** @type {unknown[]} */
  const checked = [];
  const controller = loadDatabaseController({
    CheckDatabaseConnection: async (/** @type {unknown} */ input) => {
      checked.push(input);
      return answer;
    },
  });
  return {
    route: controller.route("POST", "/database/connections/check"),
    checked,
  };
}

/** Fails on a check left open to any tenant user, or that reads its input from elsewhere than the body. */
void test("the check is bound to the owner guard and reads the body", () => {
  const { route } = checkRoute({ ok: true, data: {}, changes: [] });
  assert.deepEqual(route.reads, ["owner", "body"]);
});

/** Fails on a route that changes the body before core checks it, or answers anything else than what core found. */
void test("the body goes to core as it came, and the route answers what core found", async () => {
  const access = {
    reachable: true,
    latencyMs: 4,
    user: "app",
    canRead: true,
    canWrite: false,
  };
  const { route, checked } = checkRoute({
    ok: true,
    data: access,
    changes: [],
  });
  const body = { engine: "mysql", url: "mysql://app@db:3306/shop", extra: 1 };
  assert.deepEqual(await route.call(OWNER, body), access);
  assert.deepEqual(checked, [body]);
});

/** Fails on a route that answers core's refusal outside development as a success, or with another status. */
void test("outside development the check answers 403 with core's reason", async () => {
  const { route } = checkRoute({
    ok: false,
    error: {
      code: "unsupported",
      detail: "Databases are checked in development only.",
    },
  });
  const answer = await route.call(OWNER, {
    engine: "postgres",
    url: "postgres://u@h/db",
  });
  assert.ok(answer instanceof HTTPResult);
  assert.deepEqual(
    { status: answer.status, body: answer.body },
    {
      status: 403,
      body: {
        code: "forbidden",
        message: "Databases are checked in development only.",
      },
    },
  );
});

/** Fails on a route that answers a body core could not read as a success, or with another status or message. */
void test("a body core refuses answers 400 with core's message", async () => {
  const message =
    "Expected an engine of postgres, mysql, mongodb, rethinkdb and a URL of that engine; check url.";
  const { route } = checkRoute({
    ok: false,
    error: { code: "invalid_config", issues: [{ pointer: "", message }] },
  });
  const answer = await route.call(OWNER, {
    engine: "postgres",
    url: "mongodb://h/db",
  });
  assert.ok(answer instanceof HTTPResult);
  assert.deepEqual(
    { status: answer.status, body: answer.body },
    { status: 400, body: { code: "bad_request", message } },
  );
});
