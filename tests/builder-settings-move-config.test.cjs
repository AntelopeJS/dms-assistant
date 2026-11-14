const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { realProject } = require("./helpers/real-project.cjs");

const CATALOG = "@antelopejs/interface-database-catalog";

const DECLARED_BY_EXPRESSIONS = `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
      config: {
        builder: {
          projectRoot: process.env.DMS_ROOT,
          enabled: process.env.DMS_BUILDER === "on" || undefined,
        },
      },
    },
    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      config: { projectRoot: "web", api: { enabled: false } },
      importOverrides: [{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }],
    },
    "builder-db-erp": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
  },
});
`;

/**
 * Fails on a move that reads a declared key evaluating to `undefined` as unset, so that core's
 * `configureProject` replaces the expression with a literal, or that warns without both values,
 * or that holds back the connection for it.
 */
void test("a builder key the dms entry declares keeps its expression, even one that evaluates to undefined", async () => {
  delete process.env.DMS_ROOT;
  delete process.env.DMS_BUILDER;
  const app = realProject(DECLARED_BY_EXPRESSIONS);
  await app.start();
  const text = app.text();
  assert.match(text, /projectRoot: process\.env\.DMS_ROOT,/);
  assert.match(
    text,
    /enabled: process\.env\.DMS_BUILDER === "on" \|\| undefined,/,
  );
  const modules = await app.modules();
  assert.deepEqual(modules.dms?.importOverrides, [
    { interface: CATALOG, source: "builder-db-erp", id: "erp" },
  ]);
  assert.deepEqual(modules["dms-builder"]?.importOverrides, []);
  assert.deepEqual(modules["dms-builder"]?.config, {
    projectRoot: "web",
    api: { enabled: false },
  });
  const warnings = app.warnings();
  assert.equal(warnings.length, 2);
  assert.match(
    warnings[0],
    /"dms-builder" sets projectRoot to "web", and "dms" sets builder\.projectRoot to undefined\. "dms" keeps its value/,
  );
  assert.match(
    warnings[1],
    /"dms-builder" sets api\.enabled to false, and "dms" sets builder\.enabled to undefined\. "dms" keeps its value/,
  );
  assert.equal(app.notices().length, 1);
  assert.match(app.notices()[0], /"erp" from "dms-builder"/);
  assert.doesNotMatch(app.notices()[0], /projectRoot|enabled/);

  await app.start();
  assert.equal(app.text(), text);
  assert.equal(app.notices().length, 1);
});

/** @param {string} projectRoot The expression dms-assistant's `builder.projectRoot` holds */
const withLegacyProjectRoot = (projectRoot) =>
  `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
    },
    "dms-assistant": {
      source: { type: "package", package: "@antelopejs/dms-assistant", version: "^0.1.0" },
      config: { builder: { projectRoot: ${projectRoot} } },
    },
  },
});
`;

/**
 * Fails on a move that writes a `projectRoot` core resolves to another folder than the one
 * dms-assistant read from the project folder, or writes one for the folder core reads by default.
 */
void test("from the project folder, core edits the folder dms-assistant's projectRoot named, before and after the move", async () => {
  const cases = [
    ['__dirname + "/web"', "web"],
    ['"web"', "web"],
    ["__dirname", undefined],
  ];
  for (const [expression, written] of cases) {
    const app = realProject(withLegacyProjectRoot(expression));
    const legacyFolder = path.join(app.dir, written ?? "");
    await app.start();
    const modules = await app.modules();
    assert.deepEqual(
      modules.dms?.config,
      written === undefined ? {} : { builder: { projectRoot: written } },
      expression,
    );
    assert.equal(await app.sourceFolder(), legacyFolder, expression);
    assert.deepEqual(app.warnings(), [], expression);
  }
});

/**
 * Fails on a move that, run by `ajs project dev -p <folder>` from another folder, writes a
 * `projectRoot` relative to the project folder that core resolves against the folder ajs runs from,
 * drops one that names the project folder, or does not say once which folder to set by hand.
 */
void test("from another folder, the move writes no projectRoot and says once which folder to set by hand", async () => {
  const elsewhere = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ajs-cwd-")),
  );
  for (const [expression, folder] of [
    ['__dirname + "/web"', "web"],
    ["__dirname", ""],
  ]) {
    const app = realProject(withLegacyProjectRoot(expression));
    const before = {
      text: app.text(),
      folder: await app.sourceFolder(elsewhere),
    };
    await app.start(elsewhere);
    assert.deepEqual(
      { text: app.text(), folder: await app.sourceFolder(elsewhere) },
      before,
      expression,
    );
    assert.equal(app.warnings().length, 1, expression);
    assert.ok(
      app
        .warnings()[0]
        .includes(
          `builder.projectRoot on "dms-assistant" names "${path.join(app.dir, folder)}"`,
        ),
      app.warnings()[0],
    );
    assert.match(
      app.warnings()[0],
      /Set builder\.projectRoot on "dms" to that folder by hand, as an absolute path\./,
    );
    assert.deepEqual(app.notices(), [], expression);
  }
});

const DATABASE = "@antelopejs/interface-database";

/** @param {string} modules */
const withModules = (modules) =>
  `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
    },
${modules}
  },
});
`;

const DRIVERS = `    "builder-db-erp": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
    "builder-db-crm": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },`;

/**
 * Fails on a move that writes the access ListEntryConnections answers onto the binding it moves,
 * or registers a connection on dms-database, or that reads only the modules core loaded and leaves a
 * disabled dms-builder's connections.
 */
void test("each connection of a disabled dms-builder keeps the access dms-database grants it", async () => {
  const app = realProject(
    withModules(`    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      disabled: true,
      importOverrides: [
        { interface: "${CATALOG}", source: "builder-db-erp", id: "erp" },
        { interface: "${CATALOG}", source: "builder-db-crm", id: "crm" },
      ],
    },
    "dms-database": {
      source: { type: "package", package: "@antelopejs/dms-database", version: "^0.5.0" },
      config: { externalConnections: { erp: { access: "read-write" } } },
      importOverrides: [
        { interface: "${DATABASE}", source: "builder-db-erp", id: "erp" },
        { interface: "${DATABASE}", source: "builder-db-crm", id: "crm" },
      ],
    },
${DRIVERS}`),
  );
  const answered = [
    {
      interface: CATALOG,
      source: "builder-db-erp",
      id: "erp",
      access: "read-write",
    },
    { interface: CATALOG, source: "builder-db-crm", id: "crm", access: "read" },
  ];
  assert.deepEqual(await app.connections("dms-builder"), {
    ok: true,
    data: answered,
    changes: [],
  });
  const registered = await app.connections("dms-database");
  await app.start();
  assert.deepEqual(await app.connections("dms"), {
    ok: true,
    data: answered,
    changes: [],
  });
  assert.deepEqual(await app.connections("dms-builder"), {
    ok: true,
    data: [],
    changes: [],
  });
  assert.deepEqual(await app.connections("dms-database"), registered);
  assert.equal(app.text().match(/access:/g)?.length, 1);
  assert.deepEqual(app.warnings(), []);
  assert.equal(app.notices().length, 1);
});

/**
 * Fails on a move that writes over a configuration ConfigureProject refuses for a duplicated id, or
 * that names the first entry written under it, instead of the last one, which core evaluates and
 * ListEntryConnections reads, as what to move by hand.
 */
void test("with a duplicated id, the move writes nothing and names the last entry's settings and connections to move by hand", async () => {
  const app = realProject(
    withModules(`    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      config: { api: { enabled: true } },
      importOverrides: [{ interface: "${CATALOG}", source: "builder-db-crm", id: "crm" }],
    },
    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      disabled: true,
      config: { api: { enabled: false } },
      importOverrides: [{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }],
    },
${DRIVERS}`),
  );
  const before = app.text();
  await app.start();
  assert.equal(app.text(), before);
  assert.deepEqual(app.notices(), []);
  assert.equal(app.warnings().length, 1);
  assert.match(app.warnings()[0], /written 2 times/);
  assert.match(app.warnings()[0], /the connection "erp" from "dms-builder"/);
  assert.match(app.warnings()[0], /api\.enabled false from "dms-builder"/);
  assert.doesNotMatch(app.warnings()[0], /crm|enabled true/);
});

/**
 * Fails on a move that recognises a legacy entry only by `source.package`, so that a dms-builder
 * declared from a local folder, as the playground declares dms-assistant, keeps its connection.
 */
void test("a disabled dms-builder declared from a local folder is recognised by its package.json", async () => {
  const app = realProject(
    withModules(`    "dms-builder": {
      source: { type: "local", path: "./vendor/dms-builder" },
      disabled: true,
      importOverrides: [{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }],
    },
${DRIVERS}`),
  );
  const folder = path.join(app.dir, "vendor", "dms-builder");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "package.json"),
    JSON.stringify({ name: "@antelopejs/dms-builder" }),
  );
  await app.start();
  assert.deepEqual(await app.connections("dms"), {
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
  });
  assert.equal(app.notices().length, 1);
  assert.match(app.notices()[0], /"erp" from "dms-builder"/);
});

/**
 * Fails on a move that skips the dms-ai entry, on which the connect flow of dms-builder 0.11.0 also
 * declared each catalog connection: a connection only dms-ai holds is lost when dms-ai is removed,
 * and one it shares with dms-builder is written back on dms-ai instead of leaving it. Fails too on a
 * move that declares the shared connection twice on dms, or moves again on the next start.
 */
void test("moves a disabled dms-ai entry's catalog connections with dms-builder's, each once", async () => {
  const app = realProject(
    withModules(`    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      disabled: true,
      importOverrides: [{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }],
    },
    "dms-ai": {
      source: { type: "package", package: "@antelopejs/dms-ai", version: "^0.9.0" },
      disabled: true,
      importOverrides: [
        { interface: "${CATALOG}", source: "builder-db-erp", id: "erp" },
        { interface: "${CATALOG}", source: "builder-db-crm", id: "crm" },
      ],
    },
    "dms-database": {
      source: { type: "package", package: "@antelopejs/dms-database", version: "^0.5.0" },
      config: { externalConnections: { erp: { access: "read-write" } } },
      importOverrides: [
        { interface: "${DATABASE}", source: "builder-db-erp", id: "erp" },
        { interface: "${DATABASE}", source: "builder-db-crm", id: "crm" },
      ],
    },
${DRIVERS}`),
  );
  const registered = await app.connections("dms-database");
  await app.start();
  assert.deepEqual(await app.connections("dms"), {
    ok: true,
    data: [
      {
        interface: CATALOG,
        source: "builder-db-erp",
        id: "erp",
        access: "read-write",
      },
      {
        interface: CATALOG,
        source: "builder-db-crm",
        id: "crm",
        access: "read",
      },
    ],
    changes: [],
  });
  for (const legacy of ["dms-builder", "dms-ai"]) {
    assert.deepEqual(
      await app.connections(legacy),
      { ok: true, data: [], changes: [] },
      legacy,
    );
  }
  assert.deepEqual(await app.connections("dms-database"), registered);
  assert.deepEqual(app.warnings(), []);
  assert.equal(app.notices().length, 1);
  assert.match(app.notices()[0], /"erp" from "dms-builder"/);
  assert.match(app.notices()[0], /"crm" from "dms-ai"/);

  const text = app.text();
  await app.start();
  assert.equal(app.text(), text);
  assert.equal(app.notices().length, 1);
});

/** @param {string} mcp The `mcp` member of the dms entry's config */
const withDmsAi = (mcp) =>
  `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "app",
  modules: {
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
      config: { ${mcp} },
    },
    "dms-ai": {
      source: { type: "package", package: "@antelopejs/dms-ai", version: "^0.9.0" },
      disabled: true,
      config: { backendUrl: "http://localhost:5099" },
    },
  },
});
`;

/**
 * Fails on a move that leaves dms-ai's backendUrl behind, so that the bridge of the DMS MCP server
 * loses its origin once dms-ai is removed; that writes it anywhere but mcp.backendUrl on dms or drops
 * the other mcp keys dms holds; or that writes over an mcp.backendUrl dms declares, even one an unset
 * variable leaves undefined, or says nothing of it.
 */
void test("moves dms-ai's backendUrl to mcp.backendUrl on dms, once, unless dms declares its own", async () => {
  delete process.env.DMS_BACKEND;
  const moved = withDmsAi("mcp: { enabled: true }");
  const app = realProject(moved);
  await app.start();
  assert.deepEqual(
    new Map(Object.entries(await app.declarations())).get("dms")?.config,
    { mcp: { enabled: true, backendUrl: "http://localhost:5099" } },
  );
  assert.deepEqual(app.warnings(), []);
  assert.equal(app.notices().length, 1);
  assert.ok(
    app
      .notices()[0]
      .includes(
        'backendUrl "http://localhost:5099" from "dms-ai", as mcp.backendUrl',
      ),
    app.notices()[0],
  );
  const text = app.text();
  await app.start();
  assert.equal(app.text(), text);
  assert.equal(app.notices().length, 1);

  const declared = realProject(
    withDmsAi("mcp: { backendUrl: process.env.DMS_BACKEND }"),
  );
  const before = declared.text();
  await declared.start();
  assert.equal(declared.text(), before);
  assert.deepEqual(declared.notices(), []);
  assert.equal(declared.warnings().length, 1);
  assert.ok(
    declared
      .warnings()[0]
      .includes(
        '"dms-ai" sets backendUrl to "http://localhost:5099", and "dms" sets mcp.backendUrl to undefined. "dms" keeps its value; remove backendUrl from "dms-ai".',
      ),
    declared.warnings()[0],
  );
});
