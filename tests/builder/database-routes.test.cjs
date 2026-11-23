const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const {
  HTTPResult,
  loadDatabaseController,
} = require("./helpers/database-controller.cjs");

const OWNER = { _id: "owner" };
const CHANGED = {
  ok: true,
  data: { files: ["antelope.config.ts"] },
  changes: [],
};
const RUNNING = {
  ok: true,
  data: { id: "job-1", connection: "erp", status: "running" },
  changes: [],
};
const PROJECT = {
  modules: ["dms", "mongodb"],
  self: "dms",
  ownDatabase: "mongodb",
  databasePins: [],
  interfaceDatabase: "0.3.1",
  drivers: {
    postgres: { package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
  },
};
const WIRING = { wiring: { connection: "erp", driver: "builder-db-erp" } };
const STEPS = [{ op: "RemoveModule", id: "old" }];
const VARIABLES = [{ name: "ERP_URL", value: "postgres://u@h/erp" }];

/**
 * @typedef {{
 *   verb: string,
 *   path: string,
 *   reads: string[],
 *   args: unknown[],
 *   operation: string,
 *   called: unknown[],
 *   answer: unknown,
 *   expected: unknown,
 * }} Row
 */

/** @type {Row[]} */
const ROUTES = [
  {
    verb: "GET",
    path: "/database/connections",
    reads: ["owner"],
    args: [],
    operation: "ListDatabaseConnections",
    called: [],
    answer: [{ id: "erp", engine: "postgresql" }],
    expected: [{ id: "erp", engine: "postgresql" }],
  },
  {
    verb: "POST",
    path: "/database/connections/repair",
    reads: ["owner", "body"],
    args: [{ dryRun: true }],
    operation: "RepairDatabaseConnections",
    called: [{ dryRun: true }],
    answer: CHANGED,
    expected: CHANGED,
  },
  {
    verb: "POST",
    path: "/database/analyse",
    reads: ["owner", "body"],
    args: [{ connection: "erp", module: "erp-tables", schemas: ["public"] }],
    operation: "AnalyseDatabase",
    called: [{ connection: "erp", module: "erp-tables", schemas: ["public"] }],
    answer: RUNNING,
    expected: RUNNING,
  },
  {
    verb: "GET",
    path: "/database/analysis",
    reads: ["owner", "query:id", "query:connection"],
    args: ["job-1", undefined],
    operation: "GetAnalysis",
    called: ["job-1"],
    answer: RUNNING,
    expected: RUNNING,
  },
  {
    verb: "GET",
    path: "/database/analysis",
    reads: ["owner", "query:id", "query:connection"],
    args: [undefined, "erp"],
    operation: "GetLatestAnalysis",
    called: ["erp"],
    answer: RUNNING,
    expected: RUNNING,
  },
  {
    verb: "POST",
    path: "/database/map",
    reads: ["owner", "body"],
    args: [{ module: "erp-tables", connection: "erp", resources: [] }],
    operation: "MapResources",
    called: [{ module: "erp-tables", connection: "erp", resources: [] }],
    answer: CHANGED,
    expected: CHANGED,
  },
  {
    verb: "GET",
    path: "/database/mapping",
    reads: ["owner", "query:connection", "query:module"],
    args: ["erp", "erp-tables"],
    operation: "GetMapping",
    called: ["erp", "erp-tables"],
    answer: { ok: true, data: [], changes: [] },
    expected: { ok: true, data: [], changes: [] },
  },
  {
    verb: "GET",
    path: "/database/project",
    reads: ["owner"],
    args: [],
    operation: "GetDatabaseProject",
    called: [],
    answer: { ok: true, data: PROJECT, changes: [] },
    expected: PROJECT,
  },
  {
    verb: "POST",
    path: "/database/project",
    reads: ["owner", "body", "header:x-dms-ui-assistant"],
    args: [{ steps: STEPS, opts: { dryRun: false }, variables: VARIABLES }],
    operation: "ConfigureProject",
    called: [STEPS, { dryRun: false, variables: VARIABLES }],
    answer: CHANGED,
    expected: CHANGED,
  },
  {
    verb: "GET",
    path: "/database/connection",
    reads: ["owner", "query:connection"],
    args: ["erp"],
    operation: "GetDatabaseConnection",
    called: ["erp"],
    answer: { ok: true, data: WIRING, changes: [] },
    expected: WIRING,
  },
  {
    verb: "POST",
    path: "/database/connection/remove",
    reads: ["owner", "body"],
    args: [{ connection: "erp", dryRun: true }],
    operation: "RemoveDatabaseConnection",
    called: ["erp", { dryRun: true }],
    answer: CHANGED,
    expected: CHANGED,
  },
  {
    verb: "POST",
    path: "/database/connection/url",
    reads: ["owner", "body", "header:x-dms-ui-assistant"],
    args: [{ connection: "erp", url: "postgres://u@h/erp" }],
    operation: "SetDatabaseConnectionUrl",
    called: ["erp", "postgres://u@h/erp"],
    answer: { ok: true, data: { variable: "ERP_URL" }, changes: [] },
    expected: { ok: true, data: { variable: "ERP_URL" }, changes: [] },
  },
];

/**
 * @param {Record<string, unknown>} answers
 */
function fakeCore(answers) {
  /** @type {[string, unknown[]][]} */
  const calls = [];
  /** @type {Record<string, (...args: unknown[]) => Promise<unknown>>} */
  const core = {};
  for (const row of ROUTES) {
    core[row.operation] = async (...args) => {
      calls.push([row.operation, args]);
      return answers[row.operation];
    };
  }
  return { core, calls };
}

/** @param {string} operation @param {unknown} answer */
function answering(operation, answer) {
  return fakeCore({ [operation]: answer });
}

void test("each database route runs its core operation for the tenant owner and answers in the onboarding's shape", async () => {
  for (const row of ROUTES) {
    const { core, calls } = answering(row.operation, row.answer);
    const controller = loadDatabaseController(core);
    const name = `${row.verb} ${row.path} → ${row.operation}`;
    assert.equal(controller.prefix, "/api/builder", name);
    const route = controller.route(row.verb, row.path);
    assert.deepEqual(route.reads, row.reads, name);
    assert.deepEqual(
      await route.callAsUi(OWNER, ...row.args),
      row.expected,
      name,
    );
    assert.deepEqual(
      calls,
      [
        ["GetDatabaseProject", []],
        [row.operation, row.called],
      ],
      name,
    );
  }
});

void test("no route answers rows of the external database: /database/sample is bound to no verb", () => {
  const controller = loadDatabaseController({});
  for (const verb of ["GET", "POST"]) {
    assert.throws(
      () => controller.route(verb, "/database/sample"),
      { message: `0 routes are bound to ${verb} /database/sample` },
      verb,
    );
  }
});

const REFUSED = {
  ok: false,
  error: {
    code: "invalid_config",
    issues: [
      { pointer: "", message: "dms-database is written with a spread" },
      { pointer: "", message: "write it as an object" },
    ],
  },
};

void test("a read the onboarding takes as is answers 404 when core finds nothing and 422 when it refuses", async () => {
  const cases = [
    {
      operation: "GetDatabaseProject",
      verb: "GET",
      path: "/database/project",
      args: [],
      answer: REFUSED,
      status: 422,
      body: {
        code: "refused",
        message: "dms-database is written with a spread; write it as an object",
      },
    },
    {
      operation: "GetDatabaseConnection",
      verb: "GET",
      path: "/database/connection",
      args: ["erp"],
      answer: { ok: false, error: { code: "not_found", ref: "erp" } },
      status: 404,
      body: { code: "not_found", ref: "erp" },
    },
    {
      operation: "GetDatabaseConnection",
      verb: "GET",
      path: "/database/connection",
      args: ["erp"],
      answer: REFUSED,
      status: 422,
      body: {
        code: "refused",
        message: "dms-database is written with a spread; write it as an object",
      },
    },
    {
      operation: "GetLatestAnalysis",
      verb: "GET",
      path: "/database/analysis",
      args: [undefined, "erp"],
      answer: { ok: false, error: { code: "not_found", ref: "erp" } },
      status: 404,
      body: { code: "not_found", ref: "erp" },
    },
  ];
  for (const { operation, verb, path, args, answer, status, body } of cases) {
    const route = loadDatabaseController(
      answering(operation, answer).core,
    ).route(verb, path);
    const answered = await route.callAsUi(OWNER, ...args);
    assert.ok(answered instanceof HTTPResult, `${operation} ${status}`);
    assert.deepEqual(
      { status: answered.status, body: answered.body },
      { status, body },
      `${operation} ${status}`,
    );
  }
});

const UnavailableSchema = z.object({
  code: z.literal("unavailable"),
  message: z.string(),
});

void test(
  "with no provider of the builder operations, every route answers 503 at the 10 s deadline, naming builder.enabled on the dms entry",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const check = {
      verb: "POST",
      path: "/database/connections/check",
      args: [{ engine: "postgres", url: "postgres://u@h/erp" }],
      operation: "CheckDatabaseConnection",
    };
    const rows = [...ROUTES, check];
    const unanswered = new Promise(() => {});
    const controller = loadDatabaseController(
      Object.fromEntries(rows.map((row) => [row.operation, () => unanswered])),
    );
    let answered = 0;
    const answers = Promise.all(
      rows.map((row) =>
        controller
          .route(row.verb, row.path)
          .callAsUi(OWNER, ...row.args)
          .finally(() => {
            answered += 1;
          }),
      ),
    );
    t.mock.timers.tick(9_999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(answered, 0);
    t.mock.timers.tick(1);
    for (const [index, answer] of (await answers).entries()) {
      const name = `${rows[index].verb} ${rows[index].path}`;
      assert.ok(answer instanceof HTTPResult, name);
      assert.equal(answer.status, 503, name);
      const { message } = UnavailableSchema.parse(answer.body);
      assert.match(message, /builder\.enabled/, name);
      assert.match(message, /\bdms entry\b/, name);
    }
  },
);

void test(
  "after core left a request unanswered, a later one runs its operation once core answers",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    /** @type {() => Promise<unknown>} */
    let project = () => new Promise(() => {});
    const { core, calls } = answering("ListDatabaseConnections", []);
    const route = loadDatabaseController({
      ...core,
      GetDatabaseProject: () => project(),
    }).route("GET", "/database/connections");
    const unanswered = route.callAsUi(OWNER);
    t.mock.timers.tick(10_000);
    const first = await unanswered;
    assert.ok(first instanceof HTTPResult);
    assert.equal(first.status, 503);
    assert.deepEqual(calls, []);
    project = async () => ({ ok: true, data: PROJECT, changes: [] });
    assert.deepEqual(await route.callAsUi(OWNER), []);
    assert.deepEqual(calls, [["ListDatabaseConnections", []]]);
  },
);

const CORE_BUILDER_DISABLED =
  "The DMS builder is not enabled in this environment. Set builder.enabled to true in the dms module's config, or leave it unset and run the project with ajs project dev.";

void test(
  "when the DMS rejects every operation as off, every route answers 503 at once, with core's message",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const check = {
      verb: "POST",
      path: "/database/connections/check",
      args: [{ engine: "postgres", url: "postgres://u@h/erp" }],
      operation: "CheckDatabaseConnection",
    };
    const rows = [...ROUTES, check];
    const off = () => Promise.reject(new Error(CORE_BUILDER_DISABLED));
    const controller = loadDatabaseController({
      ...Object.fromEntries(rows.map((row) => [row.operation, off])),
      GetDatabaseProject: off,
    });
    for (const row of rows) {
      const name = `${row.verb} ${row.path}`;
      const answer = await controller
        .route(row.verb, row.path)
        .callAsUi(OWNER, ...row.args);
      assert.ok(answer instanceof HTTPResult, name);
      assert.deepEqual(
        { status: answer.status, body: answer.body },
        {
          status: 503,
          body: { code: "unavailable", message: CORE_BUILDER_DISABLED },
        },
        name,
      );
    }
  },
);

void test(
  "an operation core rejects as off after it answered the project answers 503 with core's message, and the next request asks again",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    /** @type {() => Promise<unknown>} */
    let list = () => Promise.reject(new Error(CORE_BUILDER_DISABLED));
    const route = loadDatabaseController({
      ListDatabaseConnections: () => list(),
    }).route("GET", "/database/connections");
    const answer = await route.callAsUi(OWNER);
    assert.ok(answer instanceof HTTPResult);
    assert.deepEqual(
      { status: answer.status, body: answer.body },
      {
        status: 503,
        body: { code: "unavailable", message: CORE_BUILDER_DISABLED },
      },
    );
    list = async () => [{ id: "erp", engine: "postgresql" }];
    assert.deepEqual(await route.callAsUi(OWNER), [
      { id: "erp", engine: "postgresql" },
    ]);
  },
);

void test(
  "a DMS that rejects the project read for another reason still serves the operations, with no wait",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { core, calls } = answering("ListDatabaseConnections", [
      { id: "erp", engine: "postgresql" },
    ]);
    const route = loadDatabaseController({
      ...core,
      GetDatabaseProject: () =>
        Promise.reject(new Error("antelope.config.ts could not be read")),
    }).route("GET", "/database/connections");
    assert.deepEqual(await route.callAsUi(OWNER), [
      { id: "erp", engine: "postgresql" },
    ]);
    assert.deepEqual(calls, [["ListDatabaseConnections", []]]);
  },
);
