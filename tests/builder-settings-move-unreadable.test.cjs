const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { realProject } = require("./helpers/real-project.cjs");

const CATALOG = "@antelopejs/interface-database-catalog";
const DATABASE = "@antelopejs/interface-database";
const ERP = `{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }`;
const REGISTERED = `[{ interface: "${DATABASE}", source: "builder-db-erp", id: "erp" }]`;
const UNREADABLE = "is held in a way the builder cannot read";

/** @param {{ preamble?: string, builder?: string, database?: string, after?: string }} parts */
const projectWith = ({
  preamble = "",
  builder = `[${ERP}]`,
  database = REGISTERED,
  after = "",
}) => `import { defineConfig } from "@antelopejs/interface-core/config";

${preamble}

export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
    },
    "dms-database": {
      source: { type: "package", package: "@antelopejs/dms-database", version: "^0.5.0" },
      importOverrides: ${database},
    },
    "builder-db-erp": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      disabled: true,
      importOverrides: ${builder},
    },
${after}
  },
});
`;

const BUILDER_BY_HAND =
  'Move these there by hand: the connections of "dms-builder".';

/**
 * Fails on a move that guesses at bindings it cannot read: one that moves the connections it can
 * read, although removing a connection takes it off every entry and so strips a binding hidden in
 * the one it cannot; one that reads an entry an unreadable member written after it may override;
 * one that drops the unreadable entry's connections without a word; or one that warns more than
 * once, repeats a refusal several entries share, or leaves out the refusal or what to move by hand.
 */
void test("an entry ListEntryConnections cannot read keeps every connection where it is, and one warning says what to move by hand", async () => {
  /** @type {[Parameters<typeof projectWith>[0], string, string][]} */
  const cases = [
    [
      {
        preamble: `const SHARED = [${ERP}];`,
        builder: "[...SHARED]",
      },
      'importOverrides of module "dms-builder"',
      BUILDER_BY_HAND,
    ],
    [
      {
        preamble: `const DATABASE_OVERRIDES = ${REGISTERED};`,
        database: "DATABASE_OVERRIDES",
      },
      'importOverrides of module "dms-database"',
      'Move these there by hand: the connection "erp" from "dms-builder" (@antelopejs/interface-database-catalog from "builder-db-erp").',
    ],
    [
      {
        preamble: 'const OTHER = "other";',
        after: `    [OTHER]: {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },`,
      },
      '"modules" in the configuration',
      BUILDER_BY_HAND,
    ],
    [
      {
        preamble: "const SHARED_MODULES = {};",
        after: "    ...SHARED_MODULES,",
      },
      '"modules" in the configuration',
      BUILDER_BY_HAND,
    ],
  ];
  for (const [parts, location, byHand] of cases) {
    const app = realProject(projectWith(parts));
    const text = app.text();
    await app.start();
    assert.equal(app.text(), text, location);
    assert.deepEqual(app.notices(), [], location);
    assert.equal(app.warnings().length, 1, location);
    const [warning] = app.warnings();
    assert.ok(
      warning.includes(
        `Not moved to the "dms" entry of antelope.config.ts: ${location} ${UNREADABLE}`,
      ),
      warning,
    );
    assert.equal(warning.split(UNREADABLE).length, 2, warning);
    assert.ok(warning.endsWith(byHand), warning);
  }
});

/**
 * Fails on a move that warns twice when ConfigureProject refuses the settings after an entry's
 * connections could not be read, once for the connections and once for the settings, or whose one
 * warning leaves out either refusal or anything to move by hand, a setting or the connections.
 */
void test("one warning names every refusal once and every setting and connection to move by hand", async () => {
  const app = realProject(
    projectWith({
      preamble: `const SHARED = [${ERP}];`,
      builder: "[...SHARED]",
      after: "",
    })
      .replace(
        'source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },',
        'source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },\n      config: { builder: (process.env.DMS_ON && { enabled: true }) || {} },',
      )
      .replace(
        "disabled: true,\n",
        'disabled: true,\n      config: { projectRoot: "web", api: { enabled: true } },\n',
      ),
  );
  delete process.env.DMS_ON;
  const text = app.text();
  await app.start();
  assert.equal(app.text(), text);
  assert.deepEqual(app.notices(), []);
  assert.equal(app.warnings().length, 1, app.warnings().join("\n"));
  const [warning] = app.warnings();
  for (const refusal of [
    `importOverrides of module "dms-builder" ${UNREADABLE}`,
    `config.builder of module "dms" ${UNREADABLE}`,
  ]) {
    assert.equal(warning.split(refusal).length, 2, warning);
  }
  assert.ok(
    warning.endsWith(
      'Move these there by hand: the connections of "dms-builder"; projectRoot "web" from "dms-builder", as builder.projectRoot; api.enabled true from "dms-builder", as builder.enabled.',
    ),
    warning,
  );
});

/**
 * Fails on a move that, run by `ajs project dev -p <folder>` from another folder, takes the
 * `unsupported` answer of ListEntryConnections for a dms-builder holding nothing, and so says nothing
 * while the connection stays on the entry the person then removes; or on one that does not say to
 * start from the project folder or move the connection by hand; or on one that warns about
 * dms-assistant's own entry, which stays.
 */
void test("from another folder, the connections of dms-builder are named as not read, and dms-assistant's own entry stays quiet", async () => {
  const elsewhere = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ajs-cwd-")),
  );
  const app = realProject(projectWith({}));
  const text = app.text();
  await app.start(elsewhere);
  assert.equal(app.text(), text);
  assert.deepEqual(app.notices(), []);
  const notMoved = app
    .warnings()
    .filter((warning) => warning.includes("Not moved to"));
  assert.equal(notMoved.length, 1, app.warnings().join("\n"));
  assert.ok(
    notMoved[0].endsWith(
      `the project has no antelope.config.ts. Start ajs from the project folder "${app.dir}", or move these there by hand: the connections of "dms-builder".`,
    ),
    notMoved[0],
  );

  const own =
    realProject(`import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
    },
    "dms-assistant": {
      source: { type: "package", package: "@antelopejs/dms-assistant", version: "^0.1.0" },
      importOverrides: [${ERP}],
    },
  },
});
`);
  await own.start(elsewhere);
  assert.deepEqual(own.warnings(), []);
  assert.deepEqual(own.notices(), []);
});
