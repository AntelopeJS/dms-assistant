const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { exposesConfig, exposesEntry } = require("./helpers/built-exports.js");
const { loadModule } = require("./helpers/load-module.cjs");

/** @param {string} name */
function distFile(name) {
  return path.resolve(__dirname, "../../dist/builder", name);
}

/**
 * The builder rewrites the app's sources, so what gates it must be the core's
 * development flag -- true under `ajs project run`, false under
 * `ajs project start` -- and not `NODE_ENV`, which nothing sets on the way to a
 * production start.
 *
 * @param {boolean} dev
 */
function loadConfig(dev) {
  return loadModule(
    distFile("config.js"),
    {
      "@antelopejs/interface-core/runtime": {
        GetRuntimeInfo: async () => ({
          dev,
          projectPath: "/app",
          env: "default",
        }),
      },
    },
    exposesConfig,
  );
}

void test("enables the builder when the project runs in development", async () => {
  const config = loadConfig(true);
  config.setModuleConfig({});
  assert.equal(await config.isBuilderEnabled(), true);
});

void test("disables the builder when the project does not run in development", async () => {
  const config = loadConfig(false);
  config.setModuleConfig({});
  assert.equal(await config.isBuilderEnabled(), false);
});

void test("ignores NODE_ENV entirely", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(await loadConfig(true).isBuilderEnabled(), true);
    assert.equal(await loadConfig(false).isBuilderEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

void test("lets an explicit override turn the builder on outside development", async () => {
  const config = loadConfig(false);
  config.setModuleConfig({ api: { enabled: true } });
  assert.equal(await config.isBuilderEnabled(), true);
});

void test("lets an explicit override turn the builder off in development", async () => {
  const config = loadConfig(true);
  config.setModuleConfig({ api: { enabled: false } });
  assert.equal(await config.isBuilderEnabled(), false);
});

void test("re-decides when the module is reconfigured", async () => {
  const config = loadConfig(false);
  config.setModuleConfig({ api: { enabled: true } });
  assert.equal(await config.isBuilderEnabled(), true);
  config.setModuleConfig({});
  assert.equal(await config.isBuilderEnabled(), false);
});

/**
 * @param {boolean} dev
 */
function bootModule(dev) {
  const runtimeMock = {
    "@antelopejs/interface-core/runtime": {
      GetRuntimeInfo: async () => ({
        dev,
        projectPath: "/app",
        env: "default",
      }),
    },
  };
  const loadedRoutes = [];
  const mocks = {
    ...runtimeMock,
    "./config": loadModule(distFile("config.js"), runtimeMock, exposesConfig),
  };
  Object.defineProperty(mocks, "./routes", {
    enumerable: true,
    get: () => {
      loadedRoutes.push("./routes");
      return {};
    },
  });
  const index = loadModule(distFile("index.js"), mocks, exposesEntry);
  return { index, loadedRoutes };
}

void test("mounts no routes when the project does not run in development", async () => {
  const booted = bootModule(false);
  await booted.index.construct();
  assert.deepEqual(booted.loadedRoutes, []);
});

/** Fails on a module that keeps the routes off in development. */
void test("mounts the routes in development", async () => {
  const booted = bootModule(true);
  await booted.index.construct();
  assert.deepEqual(booted.loadedRoutes, ["./routes"]);
});

void test("mounts the routes when an override enables the builder outside development", async () => {
  const booted = bootModule(false);
  await booted.index.construct({ api: { enabled: true } });
  assert.deepEqual(booted.loadedRoutes, ["./routes"]);
});
