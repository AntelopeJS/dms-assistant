const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { realProject } = require("./helpers/real-project.cjs");

const CATALOG = "@antelopejs/interface-database-catalog";
const RESTART =
  " Start the project again for @antelopejs/dms to serve what moved.";

/**
 * @param {{ dms?: string, overrides?: string, config?: string, preamble?: string }} parts
 */
const withBuilder = ({
  dms = "",
  overrides = `[{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }]`,
  config = "{ api: { enabled: false } }",
  preamble = "",
}) => `import { defineConfig } from "@antelopejs/interface-core/config";
${preamble}
export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
      ${dms}
    },
    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      disabled: true,
      config: ${config},
      importOverrides: ${overrides},
    },
    "builder-db-erp": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
    "builder-db-crm": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
  },
});
`;

/**
 * Fails on a move that says nothing of whether the entry it emptied may go, or that does not say on
 * the start that moved that the project must start again, so that the person looks for a connection
 * the running DMS, which loaded its configuration before the move, does not serve yet; or on one
 * that says so again on a start that moved nothing.
 */
void test("once the move carried everything, the entry is safe to remove, and the start that moved says to start again", async () => {
  const app = realProject(withBuilder({}));
  await app.start();
  assert.deepEqual(app.verdicts(), [
    {
      level: "info",
      line: `dms-builder: nothing left to move, safe to remove.${RESTART}`,
    },
  ]);
  assert.match(
    app.notices()[0] ?? "",
    / Start the project again for @antelopejs\/dms to serve them\.$/,
  );
  const text = app.text();
  await app.start();
  assert.equal(app.text(), text);
  assert.deepEqual(app.warnings(), []);
  assert.deepEqual(app.verdicts().at(-1), {
    level: "info",
    line: "dms-builder: nothing left to move, safe to remove.",
  });
});

/**
 * Fails on a move that calls an entry safe to remove while a connection or a setting it did not
 * carry stays on it: one dms holds another way, or one a refused batch left behind.
 */
void test("an entry that keeps a connection or a setting is never safe to remove, and the line counts what is left", async () => {
  /** @type {[string, Parameters<typeof withBuilder>[0], string][]} */
  const cases = [
    [
      "dms holds the connection and builder.enabled another way",
      {
        dms: `config: { builder: { enabled: true } },
      importOverrides: [{ interface: "${CATALOG}", source: "builder-db-crm", id: "erp" }],`,
      },
      "dms-builder: 1 connection(s) and api.enabled still here, move them before removing.",
    ],
    [
      "core refuses the batch",
      {
        dms: "config: { builder: (process.env.DMS_ON && { enabled: true }) || {} },",
      },
      "dms-builder: 1 connection(s) and api.enabled still here, move them before removing.",
    ],
  ];
  delete process.env.DMS_ON;
  for (const [name, parts, line] of cases) {
    const app = realProject(withBuilder(parts));
    await app.start();
    assert.deepEqual(app.verdicts(), [{ level: "warn", line }], name);
  }
});

/**
 * Fails on a move that calls an entry safe to remove when it could not read its connections, as
 * from another folder (`unsupported`) or with an importOverrides held in a spread
 * (`invalid_config`), or could not read environments, as without TypeScript; or on one whose line
 * does not say which.
 */
void test("an entry the move could not read gets a line that says it is not safe to remove and why", async () => {
  const elsewhere = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ajs-cwd-")),
  );
  const unread = "dms-builder: not safe to remove, the move could not read";
  /** @type {[string, string, { cwd?: string, typescript?: boolean }, string][]} */
  const cases = [
    [
      "from another folder",
      withBuilder({ config: "{}" }),
      { cwd: elsewhere },
      `${unread} its connections.`,
    ],
    [
      "an importOverrides held in a spread",
      withBuilder({
        preamble: `const SHARED = [{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }];`,
        overrides: "[...SHARED]",
        config: "{}",
      }),
      {},
      `${unread} its connections.`,
    ],
    [
      "no TypeScript",
      withBuilder({ config: "{}" }),
      { typescript: false },
      `${unread} environments of antelope.config.ts.${RESTART}`,
    ],
  ];
  for (const [name, config, { cwd, typescript }, line] of cases) {
    const app = realProject(config, { typescript });
    await app.start(cwd);
    assert.deepEqual(app.verdicts(), [{ level: "warn", line }], name);
  }
});
