const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const path = require("node:path");
const { legacyProject, PROJECT_ROOT } = require("./helpers/legacy-project.cjs");
const { realProject } = require("./helpers/real-project.cjs");
const {
  CATALOG,
  connection,
  project,
} = require("./helpers/legacy-entries.cjs");

/**
 * Fails on a move that reads only the modules core loaded, through ListModules and GetModuleInfo,
 * so that a dms-builder marked `disabled: true`, or one core did not load, keeps its connection and
 * settings until `ajs project modules remove` deletes them, or on a move that writes the access
 * ListEntryConnections answers onto the binding it moves.
 */
void test("moves the connection and settings of a dms-builder entry that is disabled or not loaded, once", async () => {
  for (const state of [{ disabled: true }, { loaded: false }]) {
    const before = project({
      "dms-builder": {
        package: "@antelopejs/dms-builder",
        config: {
          projectRoot: path.join(PROJECT_ROOT, "web"),
          api: { enabled: false },
        },
        importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
        ...state,
      },
    });
    const app = legacyProject(before);
    await app.start();
    const after = app.entries();
    assert.deepEqual(after.dms.importOverrides, [
      connection(CATALOG, "erp", "builder-db-erp"),
    ]);
    assert.deepEqual(after.dms.config, {
      homepage: "/home",
      builder: { projectRoot: "web", enabled: false },
    });
    assert.deepEqual(after["dms-builder"].importOverrides, []);
    assert.deepEqual(after["dms-database"], before["dms-database"]);
    assert.equal(app.notices().length, 1);
    assert.match(app.notices()[0], /"erp" from "dms-builder"/);
    assert.deepEqual(app.warnings(), []);

    await app.start();
    assert.equal(app.batches.length, 1);
    assert.equal(app.notices().length, 1);
  }
});

/**
 * Fails on a move that takes a `not_found` answer for a refusal that holds back the other
 * connections and the settings, or that reads the entry's connections some other way; or on one that
 * says nothing of the connections it could not read on a dms-builder the person then removes.
 */
void test("an entry ListEntryConnections does not find moves no connection and is named, and the rest moves", async () => {
  const before = project({
    "builder-db-crm": {
      package: "@antelopejs/postgres",
      config: {},
      importOverrides: [],
    },
    "dms-assistant": {
      package: "@antelopejs/dms-assistant",
      config: {},
      importOverrides: [connection(CATALOG, "crm", "builder-db-crm")],
    },
    "dms-builder": {
      package: "@antelopejs/dms-builder",
      config: { projectRoot: path.join(PROJECT_ROOT, "web") },
      importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
    },
  });
  const app = legacyProject(before, { notFound: ["dms-builder"] });
  await app.start();
  const after = app.entries();
  assert.deepEqual(after.dms.importOverrides, [
    connection(CATALOG, "crm", "builder-db-crm"),
  ]);
  assert.deepEqual(after.dms.config, {
    homepage: "/home",
    builder: { projectRoot: "web" },
  });
  assert.deepEqual(
    after["dms-builder"].importOverrides,
    before["dms-builder"].importOverrides,
  );
  assert.deepEqual(app.warnings(), [
    '[dms-assistant] Not moved to the "dms" entry of antelope.config.ts: antelope.config.ts writes no entry "dms-builder" under modules where @antelopejs/dms can read it. Move these there by hand: the connections of "dms-builder".',
  ]);
  assert.equal(app.notices().length, 1);
  assert.doesNotMatch(app.notices()[0], /erp/);
});

/** @param {string} entries */
const declaring = (entries) =>
  `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
    },
${entries}
    "builder-db-erp": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
  },
});
`;

const ERP = `importOverrides: [{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }],`;

/**
 * Fails on a move that recognises a legacy entry only by a `package` source or the package.json of
 * a `local` one, so that it skips without a word a loaded entry whose source is a fork, a disabled
 * one from a git remote or a local folder, or one keyed dms-builder whose source cannot tell, and
 * their connection is lost when the entry is removed.
 */
void test("recognises a legacy entry by the package it loaded, its git remote, its folder or last its key", async () => {
  /** @type {[string, string, Record<string, string>, (dir: string) => void][]} */
  const cases = [
    [
      "editor",
      `    editor: {
      source: { type: "git", remote: "https://github.com/acme/builder-fork.git" },
      ${ERP}
    },`,
      { editor: "@antelopejs/dms-builder" },
      () => {},
    ],
    [
      "builder",
      `    builder: {
      source: { type: "git", remote: "git@github.com:AntelopeJS/dms-builder.git", branch: "main" },
      disabled: true,
      ${ERP}
    },`,
      {},
      () => {},
    ],
    [
      "assistant",
      `    assistant: {
      source: { type: "local-folder", path: "./vendor/dms-ai" },
      disabled: true,
      ${ERP}
    },`,
      {},
      (dir) => {
        fs.mkdirSync(path.join(dir, "vendor", "dms-ai"), { recursive: true });
        fs.writeFileSync(
          path.join(dir, "vendor", "dms-ai", "package.json"),
          JSON.stringify({ name: "@antelopejs/dms-ai" }),
        );
      },
    ],
    [
      "dms-builder",
      `    "dms-builder": {
      source: { type: "git", remote: "https://github.com/acme/tools.git" },
      disabled: true,
      ${ERP}
    },`,
      {},
      () => {},
    ],
  ];
  for (const [id, entry, installed, prepare] of cases) {
    const app = realProject(declaring(entry), { installed });
    prepare(app.dir);
    await app.start();
    assert.deepEqual(
      await app.connections("dms"),
      {
        ok: true,
        data: [
          {
            interface: CATALOG,
            source: "builder-db-erp",
            id: "erp",
            access: "read",
          },
        ],
        changes: [],
      },
      id,
    );
    assert.deepEqual(
      await app.connections(id),
      { ok: true, data: [], changes: [] },
      id,
    );
    assert.match(app.notices()[0] ?? "", new RegExp(`"erp" from "${id}"`), id);
  }
});
