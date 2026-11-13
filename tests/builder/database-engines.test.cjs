const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");

const CheckEngines = z.object({
  DATABASE_ENGINES: z.array(z.string()),
  ENGINE_SCHEMES: z.record(z.string(), z.array(z.string())),
});

const FormEngines = z.object({
  ENGINES: z.record(z.string(), z.object({ schemes: z.array(z.string()) })),
});

/** The engines and schemes the live check accepts, from the built module. */
const check = CheckEngines.parse(
  require(
    path.resolve(
      __dirname,
      "../../dist/builder/implementations/dms-builder/engine/database-access.js",
    ),
  ),
);

/** The engines and schemes the connect form offers, from the frontend's own source. */
const form = FormEngines.parse(
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

void test("the connect form offers exactly the engines the live check accepts", () => {
  assert.deepEqual(
    sorted(Object.keys(form.ENGINES)),
    sorted(check.DATABASE_ENGINES),
  );
});

void test("the live check accepts each engine's URL schemes as the connect form reads them", () => {
  for (const engine of check.DATABASE_ENGINES) {
    assert.deepEqual(
      sorted(form.ENGINES[engine]?.schemes ?? []),
      sorted(check.ENGINE_SCHEMES[engine] ?? []),
      engine,
    );
  }
});
