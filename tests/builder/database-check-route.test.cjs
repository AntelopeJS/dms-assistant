const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
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

void test("the check is bound to the owner guard and reads the body", () => {
  const { route } = checkRoute({ ok: true, data: {}, changes: [] });
  assert.deepEqual(route.reads, ["owner", "body", "header:x-dms-ui-assistant"]);
});

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
  assert.deepEqual(await route.callAsUi(OWNER, body), access);
  assert.deepEqual(checked, [body]);
});

void test("outside development the check answers 403 with core's reason", async () => {
  const { route } = checkRoute({
    ok: false,
    error: {
      code: "unsupported",
      detail: "Databases are checked in development only.",
    },
  });
  const answer = await route.callAsUi(OWNER, {
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

void test("a body core refuses answers 400 with core's message", async () => {
  const message =
    "Expected an engine of postgres, mysql, mongodb, rethinkdb and a URL of that engine; check url.";
  const { route } = checkRoute({
    ok: false,
    error: { code: "invalid_config", issues: [{ pointer: "", message }] },
  });
  const answer = await route.callAsUi(OWNER, {
    engine: "postgres",
    url: "mongodb://h/db",
  });
  assert.ok(answer instanceof HTTPResult);
  assert.deepEqual(
    { status: answer.status, body: answer.body },
    { status: 400, body: { code: "bad_request", message } },
  );
});

const MISSING_POSTGRES = {
  reachable: false,
  canRead: false,
  canWrite: false,
  reason: "Install @antelopejs/postgres to connect a PostgreSQL database.",
};

/**
 * @param {Record<string, string>} files
 */
function projectWith(files) {
  const root = mkdtempSync(path.join(tmpdir(), "dms-assistant-check-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

/**
 * @param {unknown} access
 * @param {string} projectPath
 */
function missingDriverRoute(access, projectPath) {
  return loadDatabaseController(
    {
      CheckDatabaseConnection: async () => ({
        ok: true,
        data: access,
        changes: [],
      }),
      GetDatabaseProject: async () => ({
        ok: true,
        data: {
          modules: ["dms"],
          self: "dms",
          databasePins: [],
          drivers: {
            postgres: {
              package: "@antelopejs/postgres",
              version: ">=0.4.2 <0.5.0",
            },
          },
        },
        changes: [],
      }),
    },
    projectPath,
  ).route("POST", "/database/connections/check");
}

void test("a check that misses the driver answers the command that installs it with the project's package manager", async (t) => {
  const pnpmProject = projectWith({ "pnpm-lock.yaml": "" });
  const yarnProject = projectWith({
    "package.json": JSON.stringify({ packageManager: "yarn@4.5.0" }),
    "package-lock.json": "{}",
  });
  t.after(() => {
    rmSync(pnpmProject, { recursive: true });
    rmSync(yarnProject, { recursive: true });
  });
  const body = { engine: "postgres", url: "postgres://u@h/db" };
  assert.deepEqual(
    await missingDriverRoute(MISSING_POSTGRES, pnpmProject).callAsUi(
      OWNER,
      body,
    ),
    {
      ...MISSING_POSTGRES,
      install: {
        package: "@antelopejs/postgres",
        command:
          'pnpm add --save-prefix=~ "@antelopejs/postgres@>=0.4.2 <0.5.0"',
      },
    },
  );
  assert.deepEqual(
    await missingDriverRoute(MISSING_POSTGRES, yarnProject).callAsUi(
      OWNER,
      body,
    ),
    {
      ...MISSING_POSTGRES,
      install: {
        package: "@antelopejs/postgres",
        command: 'yarn add "@antelopejs/postgres@>=0.4.2 <0.5.0"',
      },
    },
  );
});

void test("an unreachable database keeps its answer without an install step", async () => {
  const refused = {
    reachable: false,
    canRead: false,
    canWrite: false,
    reason: "The server did not answer.",
  };
  assert.deepEqual(
    await missingDriverRoute(refused, "/nonexistent-project").callAsUi(OWNER, {
      engine: "postgres",
      url: "postgres://u@h/db",
    }),
    refused,
  );
});
