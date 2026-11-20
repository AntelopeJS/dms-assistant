const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const {
  installAsTheModuleCache,
  unresolvedImports,
} = require("./helpers/installed-module.cjs");
const {
  requestHealth,
  stopChild,
  waitForPort,
} = require("./helpers/sidecar-process.cjs");

/** @type {{ scratch: string; folder: string }} */
let installed;

before(async () => {
  installed = await installAsTheModuleCache();
});

after(async () => {
  await rm(installed.scratch, { recursive: true, force: true });
});

void test("every package the installed module imports is found from where it is imported", async () => {
  assert.deepEqual(
    await unresolvedImports(installed.folder, ["dist", "sidecar/dist"]),
    [],
  );
});

void test("the installed sidecar starts and serves health", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "dms-assistant-state-"));
  const child = spawn(
    process.execPath,
    [
      path.join(installed.folder, "sidecar", "dist", "index.js"),
      "--port",
      "0",
      "--root",
      stateRoot,
    ],
    { cwd: installed.folder, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const response = await requestHealth(await waitForPort(child));
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).ok, true);
  } finally {
    await stopChild(child);
    await rm(stateRoot, { recursive: true, force: true });
  }
});
