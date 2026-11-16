const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");

const ROOT = path.resolve(__dirname, "..");
const PackSchema = z.array(
  z.object({ files: z.array(z.object({ path: z.string() })) }),
);
const TEST_ONLY_FILE =
  /(^|\/)tests\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)vitest[^/]*\.config\.[cm]?[jt]s$/;

/**
 * The paths `npm pack` would put in the tarball, without running the
 * `prepack` build.
 *
 * @returns {string[]}
 */
function packedPaths() {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const [pack] = PackSchema.parse(JSON.parse(result.stdout));
  return pack.files.map((file) => file.path);
}

void test("the published package carries no test file", () => {
  const packed = packedPaths();
  assert.ok(packed.includes("frontend-vue/dms.frontend.ts"));
  assert.deepEqual(
    packed.filter((file) => TEST_ONLY_FILE.test(file)),
    [],
  );
});
