const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const CHILD_PID = 4242;
const SIDECAR_PORT = 39001;
const BACKEND_URL = "http://127.0.0.1:41234";
const SIDECAR_OWNER_KEY = Symbol.for("@antelopejs/dms-ai/sidecar-owner");
/** @type {{ require: (request: string) => unknown }} */
const moduleMethods = Module.prototype;
const SPAWN_SIDECAR_FILE = path.resolve(
  __dirname,
  "../dist/lifecycle/spawn-sidecar.js",
);

function buildLock() {
  return JSON.stringify({
    port: SIDECAR_PORT,
    pid: CHILD_PID,
    version: "0.0.0",
    buildId: "",
    startedAt: 0,
  });
}

/**
 * Drives the real spawnSidecar with the process and filesystem stubbed: the
 * lock file is only claimed by the child we pretend to spawn, so no leftover
 * sidecar is found and a fresh spawn is forced. The process-wide owner is
 * dropped first so each test starts without a running sidecar.
 * @param {string[][]} spawns Receives the arguments of each spawned process.
 * @param {boolean} [dev] Whether the core reports a development run.
 */
function loadLauncher(spawns, dev = true) {
  delete globalThis[SIDECAR_OWNER_KEY];
  let spawned = false;
  /** @type {Record<string, unknown>} */
  const mocks = {
    "node:child_process": {
      /**
       * @param {string} command
       * @param {string[]} args
       */
      spawn: (command, args) => {
        spawned = true;
        spawns.push(args);
        return { pid: CHILD_PID, on() {}, unref() {} };
      },
    },
    "node:fs": {
      closeSync() {},
      mkdirSync() {},
      openSync: () => 1,
      readFileSync: () => {
        if (!spawned) throw new Error("no lock yet");
        return buildLock();
      },
    },
    "node:http": { get: () => ({ on() {}, destroy() {} }) },
    "node:path": path,
    zod: require("zod"),
    "@antelopejs/interface-core/logging": {
      Logging: { Info() {}, Error() {} },
    },
    "@antelopejs/interface-core/runtime": {
      GetRuntimeInfo: async () => ({
        dev,
        projectPath: process.cwd(),
        env: "default",
      }),
    },
    "../constants/module": { PRODUCTION_NODE_ENV: "production" },
    "../constants/sidecar": require("../dist/constants/sidecar.js"),
    "./build-id": { computeBuildId: () => "" },
    "./sidecar-owner": require("../dist/lifecycle/sidecar-owner.js"),
    "./terminate-process": {
      isProcessAlive: () => true,
      terminateProcess: async () => undefined,
    },
  };
  const originalRequire = moduleMethods.require;
  /**
   * @this {Module}
   * @param {string} request
   * @returns {unknown}
   */
  function requireWithMocks(request) {
    if (this === module) return originalRequire.call(this, request);
    return mocks[request] ?? {};
  }
  Module.prototype.require = requireWithMocks;
  try {
    delete require.cache[SPAWN_SIDECAR_FILE];
    return require("../dist/lifecycle/spawn-sidecar.js");
  } finally {
    Module.prototype.require = originalRequire;
    delete require.cache[SPAWN_SIDECAR_FILE];
  }
}

/**
 * @param {string[]} args
 * @param {string} flag
 */
function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

void test("passes the configured backend origin to the sidecar", async () => {
  /** @type {string[][]} */
  const spawns = [];
  await loadLauncher(spawns).spawnSidecar({
    hostProjectRoot: process.cwd(),
    backendUrl: BACKEND_URL,
  });
  assert.equal(spawns.length, 1);
  assert.equal(valueAfter(spawns[0], "--backend-url"), BACKEND_URL);
});

void test("omits the backend flag when the project did not configure it", async () => {
  /** @type {string[][]} */
  const spawns = [];
  await loadLauncher(spawns).spawnSidecar({ hostProjectRoot: process.cwd() });
  assert.equal(spawns.length, 1);
  assert.equal(valueAfter(spawns[0], "--backend-url"), null);
});

/**
 * Runs the action with `NODE_ENV` unset, as `ajs project start` leaves it.
 * @param {() => Promise<void>} action
 */
async function withoutNodeEnv(action) {
  const previous = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    await action();
  } finally {
    if (previous !== undefined) process.env.NODE_ENV = previous;
  }
}

void test("never starts the sidecar outside development, even with NODE_ENV unset", async () => {
  await withoutNodeEnv(async () => {
    /** @type {string[][]} */
    const spawns = [];
    const launcher = loadLauncher(spawns, false);
    await launcher.spawnSidecar({ hostProjectRoot: process.cwd() });
    await launcher.ensureSidecarRunning();
    assert.equal(spawns.length, 0);
    assert.equal(await launcher.isSidecarDisabled(), true);
  });
});

void test("starts the sidecar in development with NODE_ENV unset", async () => {
  await withoutNodeEnv(async () => {
    /** @type {string[][]} */
    const spawns = [];
    const launcher = loadLauncher(spawns, true);
    await launcher.spawnSidecar({ hostProjectRoot: process.cwd() });
    assert.equal(spawns.length, 1);
    assert.equal(await launcher.isSidecarDisabled(), false);
  });
});

void test("reports a development sidecar enabled before the module starts, as after a hot reload", async () => {
  await withoutNodeEnv(async () => {
    const launcher = loadLauncher([], true);
    assert.equal(await launcher.isSidecarDisabled(), false);
  });
});
