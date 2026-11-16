const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const CHECK = path.join(
  __dirname,
  "..",
  ".agents",
  "skills",
  "formal-agent-file-access",
  "check.mjs",
);
const TIMEOUT_MS = 300_000;

void test("no agent tool call reads a .env file unasked or writes a configuration file the core reads unasked, in any provider and mode (fails the permission code before #66)", () => {
  const run = spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
