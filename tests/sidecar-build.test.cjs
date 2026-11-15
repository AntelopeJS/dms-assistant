const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const {
  requestHealth,
  stopChild,
  waitForPort,
} = require("./helpers/sidecar-process.cjs");

const root = path.resolve(__dirname, "..");
const sidecarEntry = path.join(root, "sidecar", "dist", "index.js");

void test("built sidecar starts and serves health", async () => {
  assert.equal(existsSync(sidecarEntry), true);
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "dms-assistant-sidecar-"),
  );
  const child = spawn(
    process.execPath,
    [sidecarEntry, "--port", "0", "--root", stateRoot],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    const port = await waitForPort(child);
    const response = await requestHealth(port);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).ok, true);
  } finally {
    await stopChild(child);
    await rm(stateRoot, { recursive: true, force: true });
  }
});
