const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { loadDatabaseController } = require("./helpers/database-controller.cjs");
const { loadModule } = require("./helpers/load-module.cjs");

const OWNER = { _id: "owner" };

/**
 * @param {unknown} exported
 * @returns {exported is { construct: (config?: object) => Promise<void> }}
 */
function exposesConstruct(exported) {
  return (
    typeof exported === "object" &&
    exported !== null &&
    "construct" in exported &&
    typeof exported.construct === "function"
  );
}

/** @param {string} envFile */
function loadEntry(envFile) {
  return loadModule(
    path.resolve(__dirname, "../../dist/builder/index.js"),
    {
      "./config": {
        setModuleConfig: () => undefined,
        isBuilderEnabled: async () => true,
        projectEnvFile: async () => envFile,
      },
      "./routes": {},
    },
    exposesConstruct,
  );
}

/**
 * Fails on a reload answer that keeps the `.env` of the first start, so a restart that loaded the
 * new URL still reads as due; on one that takes a rewrite of the same values, quoted or not, as
 * due, which a project run without `-w` never clears; and on a reload route open to anyone but the tenant owner.
 */
void test("the reload route is due once .env changed since the project loaded it, and not after the restart that loads it", async () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "dms-assistant-reload-"),
  );
  const envFile = path.join(directory, ".env");
  try {
    writeFileSync(envFile, 'SHOP_URL="postgres://app:old@db/shop"\n');
    const entry = loadEntry(envFile);
    await entry.construct();
    const route = loadDatabaseController({}).route("GET", "/database/reload");
    assert.deepEqual(route.reads, ["owner"]);
    assert.deepEqual(await route.call(OWNER), { due: false });

    writeFileSync(envFile, 'SHOP_URL="postgres://app:old@db/shop"\n');
    assert.deepEqual(await route.call(OWNER), { due: false });

    writeFileSync(envFile, "SHOP_URL=postgres://app:old@db/shop\n");
    assert.deepEqual(await route.call(OWNER), { due: false });

    writeFileSync(envFile, 'SHOP_URL="postgres://app:fixed@db/shop"\n');
    assert.deepEqual(await route.call(OWNER), { due: true });

    await entry.construct();
    assert.deepEqual(await route.call(OWNER), { due: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
