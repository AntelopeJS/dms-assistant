const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { legacyProject, PROJECT_ROOT } = require("./helpers/legacy-project.cjs");
const {
  CATALOG,
  connection,
  project,
  sorted,
} = require("./helpers/legacy-entries.cjs");

/**
 * Fails on a move that leaves the connection on dms-assistant, does not declare it on dms, drops
 * dms-database's registration or changes its access, loses builder.projectRoot, carries over
 * dms-assistant's own builder.api.enabled, logs nothing, or writes again on the next start.
 */
void test("moves a dms-assistant entry's catalog connection and builder.projectRoot onto dms, once", async () => {
  const before = project({
    "dms-assistant": {
      package: "@antelopejs/dms-assistant",
      config: {
        builder: {
          projectRoot: path.join(PROJECT_ROOT, "web"),
          api: { enabled: true },
        },
      },
      importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
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
    builder: { projectRoot: "web" },
  });
  assert.deepEqual(after["dms-assistant"].importOverrides, []);
  assert.deepEqual(
    sorted(after["dms-database"].importOverrides),
    sorted(before["dms-database"].importOverrides),
  );
  assert.deepEqual(after["dms-database"].config, before["dms-database"].config);
  assert.equal(app.notices().length, 1);
  assert.match(app.notices()[0], /"erp" from "dms-assistant"/);
  assert.match(
    app.notices()[0],
    /builder\.projectRoot "web" from "dms-assistant"/,
  );
  assert.deepEqual(app.warnings(), []);

  await app.start();
  assert.equal(app.batches.length, 1);
  assert.equal(app.notices().length, 1);
  assert.deepEqual(app.entries(), after);
});

/**
 * Fails on a move that reads dms-builder's settings under `builder` instead of at its top level,
 * writes api.enabled anywhere but builder.enabled, drops a `false`, or leaves its connection on
 * dms-builder.
 */
void test("moves a dms-builder entry's top-level projectRoot and api.enabled to dms's builder keys", async () => {
  const app = legacyProject(
    project({
      "dms-builder": {
        package: "@antelopejs/dms-builder",
        config: {
          projectRoot: path.join(PROJECT_ROOT, "web"),
          api: { enabled: false },
        },
        importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
      },
    }),
  );
  await app.start();
  const after = app.entries();
  assert.deepEqual(after.dms.config, {
    homepage: "/home",
    builder: { projectRoot: "web", enabled: false },
  });
  assert.deepEqual(after.dms.importOverrides, [
    connection(CATALOG, "erp", "builder-db-erp"),
  ]);
  assert.deepEqual(after["dms-builder"].importOverrides, []);
  assert.equal(app.notices().length, 1);
  assert.match(
    app.notices()[0],
    /api\.enabled false from "dms-builder", as builder\.enabled/,
  );

  await app.start();
  assert.equal(app.batches.length, 1);
  assert.equal(app.notices().length, 1);
});

/**
 * Fails on a move that declares a connection on dms a second time, rewrites dms's own, keeps the
 * same connection on dms-assistant, or rewrites a setting dms already holds with that value.
 */
void test("a connection dms already declares the same way only leaves the legacy entry", async () => {
  const before = project({
    dms: {
      package: "@antelopejs/dms",
      config: { builder: { projectRoot: path.join(PROJECT_ROOT, "web") } },
      importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
    },
    "dms-assistant": {
      package: "@antelopejs/dms-assistant",
      config: { builder: { projectRoot: path.join(PROJECT_ROOT, "web") } },
      importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
    },
  });
  const app = legacyProject(before);
  await app.start();
  const after = app.entries();
  assert.deepEqual(after.dms, before.dms);
  assert.deepEqual(after["dms-assistant"].importOverrides, []);
  assert.equal(app.notices().length, 1);
  assert.match(app.notices()[0], /"erp" off "dms-assistant"/);
  assert.doesNotMatch(app.notices()[0], /projectRoot/);

  await app.start();
  assert.equal(app.batches.length, 1);
});

/** Fails on a move that asks core anything, writes or logs when no legacy entry holds what dms reads now. */
void test("nothing on a legacy entry asks, writes and logs nothing", async () => {
  const app = legacyProject(
    project({
      dms: {
        package: "@antelopejs/dms",
        config: { builder: { projectRoot: PROJECT_ROOT } },
        importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
      },
      "dms-assistant": {
        package: "@antelopejs/dms-assistant",
        config: { builder: { api: { enabled: true } } },
        importOverrides: [],
      },
    }),
  );
  await app.start();
  assert.equal(app.projectReads(), 0);
  assert.deepEqual(app.batches, []);
  assert.deepEqual(app.notices(), []);
  assert.deepEqual(app.warnings(), []);
});

/**
 * Fails on a move that overwrites or merges dms's connection or setting with a legacy one held
 * differently, takes the legacy one off its entry, holds back the rest of the move for it, or warns
 * without both values.
 */
void test("on a conflict dms keeps its own, the legacy entry keeps its own, and the warning names both", async () => {
  const before = project({
    dms: {
      package: "@antelopejs/dms",
      config: { builder: { projectRoot: path.join(PROJECT_ROOT, "dms") } },
      importOverrides: [connection(CATALOG, "erp", "builder-db-other")],
    },
    "builder-db-other": {
      package: "@antelopejs/postgres",
      config: {},
      importOverrides: [],
    },
    "builder-db-crm": {
      package: "@antelopejs/postgres",
      config: {},
      importOverrides: [],
    },
    "dms-builder": {
      package: "@antelopejs/dms-builder",
      config: { projectRoot: path.join(PROJECT_ROOT, "legacy") },
      importOverrides: [
        connection(CATALOG, "erp", "builder-db-erp"),
        connection(CATALOG, "crm", "builder-db-crm"),
      ],
    },
  });
  const app = legacyProject(before);
  await app.start();
  const after = app.entries();
  assert.deepEqual(
    sorted(after.dms.importOverrides),
    sorted([
      connection(CATALOG, "erp", "builder-db-other"),
      connection(CATALOG, "crm", "builder-db-crm"),
    ]),
  );
  assert.deepEqual(after.dms.config, before.dms.config);
  assert.deepEqual(after["dms-builder"].importOverrides, [
    connection(CATALOG, "erp", "builder-db-erp"),
  ]);
  assert.deepEqual(after["dms-builder"].config, before["dms-builder"].config);
  const warnings = app.warnings();
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /"erp".*"builder-db-erp".*"builder-db-other"/);
  assert.match(
    warnings[1],
    /projectRoot to "legacy".*builder\.projectRoot to "dms"/,
  );
  assert.equal(app.notices().length, 1);
  assert.match(app.notices()[0], /"crm" from "dms-builder"/);
  assert.doesNotMatch(app.notices()[0], /"erp"/);

  await app.start();
  assert.equal(app.batches.length, 1);
  assert.equal(app.notices().length, 1);
});

/**
 * Fails on a move that core refuses and that then says nothing, or does not name what to set by
 * hand, as when core finds no antelope.config.ts under its own builder.projectRoot.
 */
void test("a refused move writes nothing and says what to set on dms by hand", async () => {
  const before = project({
    "dms-assistant": {
      package: "@antelopejs/dms-assistant",
      config: { builder: { projectRoot: path.join(PROJECT_ROOT, "web") } },
      importOverrides: [],
    },
  });
  const app = legacyProject(before, {
    refusal: {
      ok: false,
      error: {
        code: "unsupported",
        detail: "the project has no antelope.config.ts",
      },
    },
  });
  await app.start();
  assert.deepEqual(app.entries(), before);
  assert.deepEqual(app.notices(), []);
  assert.equal(app.warnings().length, 1);
  assert.match(app.warnings()[0], /the project has no antelope\.config\.ts/);
  assert.match(
    app.warnings()[0],
    /builder\.projectRoot "web" from "dms-assistant"/,
  );
});

/**
 * Fails on a move that writes the loaded value, the absolute path `__dirname` stands for, as
 * builder.projectRoot on dms, or writes any projectRoot for a folder core's default already reads.
 */
void test("a legacy projectRoot that resolves to the project root moves no projectRoot onto dms", async () => {
  const legacy = [
    [
      "dms-assistant",
      "@antelopejs/dms-assistant",
      { builder: { projectRoot: PROJECT_ROOT } },
    ],
    ["dms-builder", "@antelopejs/dms-builder", { projectRoot: "./" }],
  ];
  for (const [id, packageName, config] of legacy) {
    const app = legacyProject(
      project({
        [id]: {
          package: packageName,
          config,
          importOverrides: [connection(CATALOG, "erp", "builder-db-erp")],
        },
      }),
    );
    await app.start();
    const after = app.entries();
    assert.deepEqual(after.dms.importOverrides, [
      connection(CATALOG, "erp", "builder-db-erp"),
    ]);
    assert.deepEqual(after.dms.config, { homepage: "/home" });
    assert.equal(app.notices().length, 1);
    assert.doesNotMatch(app.notices()[0], /projectRoot/);
    assert.deepEqual(app.warnings(), []);
  }
});

/**
 * Fails on a move that writes the loaded absolute path, a path relative to the process's working
 * directory instead of the project root, or `\` separators, or that writes or warns again on the
 * next start because it compares the relative value on dms with the absolute one it came from.
 */
void test("any other legacy projectRoot lands on dms relative to the project root, once", async () => {
  const cases = [
    [path.join(PROJECT_ROOT, "apps", "web"), "apps/web"],
    ["apps/web", "apps/web"],
    [path.resolve(PROJECT_ROOT, "..", "shared"), "../shared"],
  ];
  for (const [loaded, written] of cases) {
    const app = legacyProject(
      project({
        "dms-assistant": {
          package: "@antelopejs/dms-assistant",
          config: { builder: { projectRoot: loaded } },
          importOverrides: [],
        },
      }),
    );
    await app.start();
    assert.deepEqual(app.entries().dms.config, {
      homepage: "/home",
      builder: { projectRoot: written },
    });
    await app.start();
    assert.equal(app.batches.length, 1);
    assert.equal(app.notices().length, 1);
    assert.deepEqual(app.warnings(), []);
  }
});

/**
 * Fails on a move that gives dms-builder's projectRoot precedence over dms-assistant's when both
 * set one, writes both, or drops the warning that names the one left behind.
 */
void test("when dms-assistant and dms-builder set different projectRoots, dms-assistant's moves and dms-builder's is named", async () => {
  const app = legacyProject(
    project({
      "dms-assistant": {
        package: "@antelopejs/dms-assistant",
        config: { builder: { projectRoot: path.join(PROJECT_ROOT, "web") } },
        importOverrides: [],
      },
      "dms-builder": {
        package: "@antelopejs/dms-builder",
        config: { projectRoot: path.join(PROJECT_ROOT, "legacy") },
        importOverrides: [],
      },
    }),
  );
  await app.start();
  assert.deepEqual(app.entries().dms.config, {
    homepage: "/home",
    builder: { projectRoot: "web" },
  });
  assert.equal(app.notices().length, 1);
  assert.match(
    app.notices()[0],
    /builder\.projectRoot "web" from "dms-assistant"/,
  );
  assert.equal(app.warnings().length, 1);
  assert.match(
    app.warnings()[0],
    /"dms-builder" sets projectRoot to "legacy", and "dms" sets builder\.projectRoot to "web"/,
  );
});
