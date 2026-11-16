const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const CHECK = path.join(
  __dirname,
  "..",
  ".agents",
  "skills",
  "formal-connection-analysis",
  "check.mjs",
);
const TIMEOUT_MS = 300_000;

void test("two tabs following one connection start its analysis once and keep the newest attempt (fails the onboarding code before the Web Lock handover)", () => {
  const run = spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
