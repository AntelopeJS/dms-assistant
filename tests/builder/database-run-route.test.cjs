const assert = require("node:assert/strict");
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

function loadEntry() {
  return loadModule(
    path.resolve(__dirname, "../../dist/builder/index.js"),
    {
      "./config": {
        setModuleConfig: () => undefined,
        isBuilderEnabled: async () => false,
      },
    },
    exposesConstruct,
  );
}

/**
 * Fails on a run named once per process, which an in-process restart of the project keeps: the
 * popup would then wait on a URL the project already loaded. Fails too on a run route open to
 * anyone but the tenant owner.
 */
void test("the run route answers the same run until the module constructs again, as a restart of the project does", async () => {
  const route = loadDatabaseController({}).route("GET", "/database/run");
  assert.deepEqual(route.reads, ["owner"]);
  const before = await route.call(OWNER);
  assert.deepEqual(await route.call(OWNER), before);

  await loadEntry().construct();
  const after = await route.call(OWNER);
  assert.notDeepEqual(after, before);
  assert.deepEqual(await route.call(OWNER), after);
});
