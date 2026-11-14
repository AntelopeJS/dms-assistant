const assert = require("node:assert/strict");
const {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, test } = require("node:test");
const { z } = require("zod");
const { interceptRequire } = require("./helpers/intercept-require.cjs");

const STEP_PATH = path.resolve(
  __dirname,
  "../dist/lifecycle/project-mcp-json.js",
);
const DMS_PACKAGE_DIR = path.resolve(
  __dirname,
  "../node_modules/@antelopejs/dms",
);
const MCP_JSON = ".mcp.json";
const DMS_ASSISTANT_ENTRY = {
  command: "node",
  args: ["node_modules/.cache/dms-assistant/mcp-bridge.cjs"],
};
const DMS_ENTRY = {
  command: "node",
  args: ["node_modules/.cache/dms/mcp-bridge.cjs"],
};
const LONG_AGO = new Date("2020-01-01T00:00:00Z");

const CoreProjectFilesSchema = z.object({
  publishBridge: z.function({
    input: [
      z.object({
        projectPath: z.string(),
        url: z.string(),
        token: z.string(),
        writeMcpJson: z.boolean(),
      }),
    ],
    output: z.promise(z.void()),
  }),
  formatMcpJson: z.function({ input: [z.json()], output: z.string() }),
});
const StepSchema = z.object({
  syncProjectMcpJson: z.function({
    input: [z.string()],
    output: z.promise(z.void()),
  }),
});

/** The files `@antelopejs/dms` writes at its start, from the pinned package. */
const core = CoreProjectFilesSchema.parse(
  require(path.join(DMS_PACKAGE_DIR, "dist/mcp/project-files.js")),
);

/** @type {string} */
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "dms-assistant-mcp-json-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Loads the step with the DMS module answering `dmsConfig` through
 * interface-core.
 * @param {unknown} [dmsConfig] - The config the DMS module was loaded with.
 * @param {boolean} [isDmsLoaded] - Whether a module of the project is `@antelopejs/dms`.
 */
function loadStep(dmsConfig = {}, isDmsLoaded = true) {
  /** @type {unknown[][]} */
  const warnings = [];
  /** @type {unknown[][]} */
  const notices = [];
  const restore = interceptRequire(
    {
      "@antelopejs/interface-core/logging": {
        Logging: {
          /** @param {unknown[]} args - The warning. */
          Warn: (...args) => warnings.push(args),
          /** @param {unknown[]} args - The notice. */
          Info: (...args) => notices.push(args),
        },
      },
      "@antelopejs/interface-core/modules": {
        ListModules: async () => ["dms", "dms-assistant"],
        /** @param {string} id - The module asked about. */
        GetModuleInfo: async (id) => ({
          localPath:
            id === "dms" && isDmsLoaded
              ? DMS_PACKAGE_DIR
              : path.resolve(__dirname, ".."),
          config: id === "dms" ? dmsConfig : {},
        }),
      },
    },
    false,
    module,
  );
  try {
    delete require.cache[STEP_PATH];
    return { ...StepSchema.parse(require(STEP_PATH)), warnings, notices };
  } finally {
    restore();
  }
}

/** @param {unknown} value - The content to write as `.mcp.json`. */
function writeMcpJson(value) {
  return writeFile(
    path.join(dir, MCP_JSON),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function readMcpJson() {
  return readFile(path.join(dir, MCP_JSON), "utf8");
}

/**
 * Core's start writing its bridge, launcher included.
 * @param {boolean} [writeMcpJson] - Whether core adds its entry to `.mcp.json` too.
 */
function coreStarts(writeMcpJson = true) {
  return core.publishBridge({
    projectPath: dir,
    url: "http://localhost:5010/mcp",
    token: "token",
    writeMcpJson,
  });
}

/**
 * The file holds exactly `expected`, keys in its order, printed as the DMS
 * prints it, which is how the projects' formatter prints it.
 * @param {string} text - The file's content.
 * @param {unknown} expected - The content it must hold.
 */
function assertHolds(text, expected) {
  const held = z.json().parse(JSON.parse(text));
  assert.equal(JSON.stringify(held), JSON.stringify(expected));
  assert.equal(text, `${core.formatMcpJson(held)}\n`);
}

void test("no .mcp.json: the step writes core's entry alone, or nothing when the project turned core's writing off (fails a step that throws on a missing file or writes more)", async () => {
  await coreStarts(false);
  await loadStep().syncProjectMcpJson(dir);
  assertHolds(await readMcpJson(), { mcpServers: { dms: DMS_ENTRY } });
  await rm(path.join(dir, MCP_JSON));
  await loadStep({ mcp: { mcpJson: false } }).syncProjectMcpJson(dir);
  await assert.rejects(stat(path.join(dir, MCP_JSON)), { code: "ENOENT" });
});

void test("a hand-edited .mcp.json keeps every other server, key and order, a dms-assistant entry included (fails a step that reorders, drops keys or removes a dms-assistant entry)", async () => {
  const github = { command: "npx", args: ["-y", "@github/mcp"] };
  const ownDmsAssistant = {
    command: "node",
    args: ["tools/dms-assistant.cjs"],
  };
  const zeta = { url: "http://localhost:9000/mcp" };
  const cases = [
    [
      {
        mcpServers: { github, "dms-assistant": DMS_ASSISTANT_ENTRY, zeta },
        extra: [1],
      },
      {
        mcpServers: {
          github,
          "dms-assistant": DMS_ASSISTANT_ENTRY,
          zeta,
          dms: DMS_ENTRY,
        },
        extra: [1],
      },
    ],
    [
      {
        $schema: "x",
        mcpServers: { github, "dms-assistant": ownDmsAssistant, zeta },
      },
      {
        $schema: "x",
        mcpServers: {
          github,
          "dms-assistant": ownDmsAssistant,
          zeta,
          dms: DMS_ENTRY,
        },
      },
    ],
  ];
  await coreStarts(false);
  for (const [before, after] of cases) {
    await writeMcpJson(before);
    await loadStep().syncProjectMcpJson(dir);
    assertHolds(await readMcpJson(), after);
  }
});

void test("core wrote no launcher, as when its backend is not on this machine: the step adds no dms entry (fails a step that adds an entry whose launcher does not exist)", async () => {
  await writeMcpJson({ mcpServers: { other: {} } });
  const step = loadStep({ mcp: { backendUrl: "https://api.example.com" } });
  await step.syncProjectMcpJson(dir);
  assertHolds(await readMcpJson(), { mcpServers: { other: {} } });
  await coreStarts(false);
  await step.syncProjectMcpJson(dir);
  assertHolds(await readMcpJson(), {
    mcpServers: { other: {}, dms: DMS_ENTRY },
  });
});

void test("nothing to change: the step does not rewrite the file, its bytes and mtime unchanged (fails a step that rewrites the file on every start)", async () => {
  await coreStarts(false);
  const filePath = path.join(dir, MCP_JSON);
  const text = `{\n    "mcpServers": {\n        "dms": ${JSON.stringify(DMS_ENTRY)}\n    }\n}\n`;
  await writeFile(filePath, text);
  await utimes(filePath, LONG_AGO, LONG_AGO);
  const step = loadStep();
  await step.syncProjectMcpJson(dir);
  assert.equal(await readMcpJson(), text);
  assert.equal((await stat(filePath)).mtimeMs, LONG_AGO.getTime());
  assert.equal(step.notices.length, 0);
});

void test("core's writing off, or a DMS config it cannot read: the step adds nothing (fails a step that adds an entry core will not serve)", async () => {
  const steps = [
    loadStep({ mcp: { mcpJson: false } }),
    loadStep({ mcp: { enabled: false } }),
    loadStep({ mcp: { mcpJson: "no" } }),
    loadStep({}, false),
  ];
  await coreStarts(false);
  for (const step of steps) {
    await writeMcpJson({
      mcpServers: { "dms-assistant": DMS_ASSISTANT_ENTRY },
    });
    const before = await readMcpJson();
    await step.syncProjectMcpJson(dir);
    assert.equal(await readMcpJson(), before);
  }
});

void test("an unusable .mcp.json is left alone with one warning (fails a step that overwrites a file it cannot read)", async () => {
  for (const text of ["[1, 2]\n", "{ broken\n", '{ "mcpServers": [] }\n']) {
    await writeFile(path.join(dir, MCP_JSON), text);
    const step = loadStep();
    await step.syncProjectMcpJson(dir);
    assert.equal(await readMcpJson(), text);
    assert.equal(step.warnings.length, 1);
  }
});

/**
 * Loads the module with its start's collaborators stubbed and the step
 * recorded.
 * @param {boolean} dev - Whether the project runs in development.
 */
function loadModule(dev) {
  /** @type {(() => void)[]} */
  const listeners = [];
  /** @type {string[]} */
  const synced = [];
  const restore = interceptRequire(
    {
      "@antelopejs/interface-core/logging": { Logging: { Error() {} } },
      "@antelopejs/interface-core/runtime": {
        GetRuntimeInfo: async () => ({ dev, projectPath: dir, env: "default" }),
      },
      "@antelopejs/interface-core/modules": {
        Events: {
          ModulesStarted: {
            /** @param {() => void} listener - Called once every module started. */
            register: (listener) => listeners.push(listener),
          },
        },
      },
      "@antelopejs/interface-dms/page": { AddFrontendModule() {} },
      "./builder": { construct: async () => {} },
      "./lifecycle/module-roots": { collectModuleRoots: () => [] },
      "./lifecycle/skill-sources": { collectSkillSources: () => [] },
      "./lifecycle/spawn-sidecar": { spawnSidecar: async () => {} },
      "./lifecycle/project-mcp-json": {
        /** @param {string} root - The project the step runs on. */
        syncProjectMcpJson: async (root) => {
          synced.push(root);
        },
      },
      "./logging/log-buffer": { startLogCapture() {} },
      "./frontend-module": { frontendModule: () => ({}) },
      "./config": require("../dist/config.js"),
    },
    true,
    module,
  );
  try {
    delete require.cache[require.resolve("../dist/index.js")];
    return { ...require("../dist/index.js"), listeners, synced };
  } finally {
    restore();
  }
}

void test("the step runs in development once every module started, after core's own write, and not in production (fails a step that races core's start or never runs)", async () => {
  const dev = loadModule(true);
  await dev.construct({});
  await dev.start();
  assert.deepEqual(dev.synced, []);
  for (const listener of dev.listeners) listener();
  assert.deepEqual(dev.synced, [dir]);
  const production = loadModule(false);
  await production.construct({});
  await production.start();
  assert.equal(production.listeners.length, 0);
});
