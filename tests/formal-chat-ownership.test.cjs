const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const CHECK = path.join(
  __dirname,
  "..",
  ".agents",
  "skills",
  "formal-chat-ownership",
  "check.mjs",
);
const TIMEOUT_MS = 300_000;

void test("every chat socket message type honours the conversation owner (fails a handler that skips the ownership check)", () => {
  const run = spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
