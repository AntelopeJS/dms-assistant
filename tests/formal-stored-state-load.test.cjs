const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const CHECK = path.join(
  __dirname,
  "..",
  ".agents",
  "skills",
  "formal-stored-state-load",
  "check.mjs",
);
const TIMEOUT_MS = 300_000;

void test("loading stored state keeps every valid entry (fails a loader that drops valid entries for one malformed one)", () => {
  const run = spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
