const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const DMS_CONTROL = path.join(
  ROOT,
  "node_modules/@antelopejs/dms/bin/dms-control.mjs",
);
const SKILLS = ["verify-dms-assistant", "verify-dms-builder"];

for (const skill of SKILLS) {
  void test(`dms-control map finds every user-facing file and journey of ${skill}`, () => {
    const result = spawnSync(
      process.execPath,
      [DMS_CONTROL, "map", "--skill", path.join(ROOT, ".agents/skills", skill)],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `a source file matches no feature glob, or a feature lacks its journeys or docs:\n${result.stdout}${result.stderr}`,
    );
  });
}
