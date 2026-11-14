const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");

const coreSchemes = z
  .record(z.string(), z.array(z.string()))
  .parse(require("@antelopejs/interface-dms-builder").DATABASE_ENGINE_SCHEMES);

const popupEngines = z
  .object({
    ENGINES: z.record(z.string(), z.object({ schemes: z.array(z.string()) })),
  })
  .parse(
    require(
      path.resolve(
        __dirname,
        "../../frontend-vue/builder/app/runtime/database-engines.ts",
      ),
    ),
  );

/** @param {readonly string[]} values */
function sorted(values) {
  return [...values].toSorted();
}

/** Fails on a popup that offers an engine core does not connect, or leaves out one it does. */
void test("the popup offers exactly the engines core connects", () => {
  assert.deepEqual(
    sorted(Object.keys(popupEngines.ENGINES)),
    sorted(Object.keys(coreSchemes)),
  );
});

/** Fails on a popup that reads a URL scheme core refuses for its engine, or misses one core accepts. */
void test("the popup reads each engine's URLs by the schemes core accepts for it", () => {
  for (const [engine, schemes] of Object.entries(coreSchemes)) {
    assert.deepEqual(
      sorted(popupEngines.ENGINES[engine]?.schemes ?? []),
      sorted(schemes),
      engine,
    );
  }
});
