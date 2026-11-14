const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ConfigLoader } = require("@antelopejs/core");
const { z } = require("zod");
const { moveLog } = require("./move-log.cjs");
const { interceptRequire, NOT_INSTALLED } = require("./intercept-require.cjs");

const CORE = path.resolve(__dirname, "../../node_modules/@antelopejs/dms/dist");
const ENGINE = path.join(CORE, "implementations/dms-builder/engine");
const CORE_CONFIG = path.resolve(
  __dirname,
  "../../node_modules/@antelopejs/core/dist/core/config",
);
const MOVE_PATH = path.resolve(
  __dirname,
  "../../dist/lifecycle/builder-settings-move.js",
);

const DIST = path.resolve(__dirname, "../../dist");

/** Drops every built module from the require cache, so the next start loads them with its mocks. */
function forgetBuiltModules() {
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(`${DIST}${path.sep}`)) delete require.cache[file];
  }
}

const CoreStateSchema = z.object({
  setBuilderConfig: z.function({ input: [z.unknown()], output: z.void() }),
});
const ConfigureSchema = z.object({
  configureProject: z.function({ input: [z.unknown()], output: z.unknown() }),
});
const ProjectRootSchema = z.object({
  resolveProjectRoot: z.function({ input: [], output: z.string() }),
});
const MoveSchema = z.object({
  moveLegacyBuilderSettings: z.function({
    input: [z.string()],
    output: z.promise(z.void()),
  }),
});

const { setBuilderConfig } = CoreStateSchema.parse(
  require(path.join(CORE, "config/internal/state.js")),
);
const { configureProject } = ConfigureSchema.parse(
  require(path.join(ENGINE, "project-config-ops.js")),
);
const { resolveProjectRoot } = ProjectRootSchema.parse(
  require(path.join(ENGINE, "project.js")),
);
const { listModuleDeclarations } = z
  .object({
    listModuleDeclarations: z.function({
      input: [z.string()],
      output: z.promise(z.record(z.string(), z.unknown())),
    }),
  })
  .parse(require(path.join(CORE_CONFIG, "module-declarations.js")));
const { ListEntryConnections } = z
  .object({
    ListEntryConnections: z.function({
      input: [z.string()],
      output: z.promise(z.unknown()),
    }),
  })
  .parse(require(path.join(CORE, "implementations/dms-builder/database.js")));

const OverrideSchema = z.object({
  interface: z.string(),
  source: z.string().optional(),
  id: z.string().optional(),
});

const ModulesSchema = z.record(
  z.string(),
  z.object({
    source: z.object({ package: z.string().optional() }),
    config: z.unknown(),
    importOverrides: z.array(OverrideSchema),
  }),
);

const DmsConfigSchema = z
  .object({ builder: z.record(z.string(), z.unknown()) })
  .catch({ builder: {} });

const DISK = {
  /** @param {string} file */
  exists: async (file) => fs.existsSync(file),
  /** @param {string} file */
  readFileString: (file) => fs.promises.readFile(file, "utf8"),
};

/**
 * @template T
 * @param {string} cwd
 * @param {() => Promise<T> | T} work
 * @returns {Promise<T>}
 */
async function inFolder(cwd, work) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await work();
  } finally {
    process.chdir(previous);
  }
}

/**
 * Whether the move reads a file of a module core loaded from `/modules/<id>`. The move joins that
 * folder with the platform's separator, so on Windows it reads `\modules\<id>\package.json`.
 *
 * @param {string} file
 */
function isLoadedModuleFile(file) {
  return file.split(path.sep).join("/").startsWith("/modules/");
}

/**
 * The fs promises of the move, where the package.json of a module core loaded from `/modules/<id>`
 * names the package `installed` gives that id.
 *
 * @param {(id: string) => string | undefined} installed
 */
function withPackageJsons(installed) {
  return {
    ...fs.promises,
    /**
     * @param {string} file
     * @param {BufferEncoding} encoding
     */
    readFile: async (file, encoding) =>
      isLoadedModuleFile(file)
        ? JSON.stringify({ name: installed(path.basename(path.dirname(file))) })
        : fs.promises.readFile(file, encoding),
  };
}

/**
 * @param {string} config
 * @param {{ installed?: Record<string, string>, typescript?: boolean }} [options] The package each
 *   loaded module's package.json names, by id, where it is not the `package` of its source; and
 *   whether the project installs TypeScript, true by default.
 */
function realProject(config, options = {}) {
  const installed = new Map(Object.entries(options.installed ?? {}));
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "real-project-")),
  );
  const file = path.join(dir, "antelope.config.ts");
  fs.writeFileSync(file, config);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "app" }),
  );
  const log = moveLog();

  const loaded = async () =>
    ModulesSchema.parse((await new ConfigLoader(DISK).load(dir)).modules);

  /** @param {z.infer<typeof ModulesSchema>} modules */
  const readByCore = (modules) =>
    setBuilderConfig(DmsConfigSchema.parse(modules.dms?.config).builder);

  /** @param {z.infer<typeof ModulesSchema>} modules */
  function mocks(modules) {
    /** @type {string | undefined} */
    let responsible;
    return {
      "@antelopejs/interface-core": {
        /**
         * @template T
         * @param {string} module
         * @param {() => T} callback
         */
        RunWithResponsibleModule: (module, callback) => {
          const previous = responsible;
          responsible = module;
          try {
            return callback();
          } finally {
            responsible = previous;
          }
        },
        /** @param {string} interfaceId */
        GetInterfaceInstances: (interfaceId) =>
          (responsible === undefined
            ? []
            : (modules[responsible]?.importOverrides ?? [])
          )
            .filter((item) => item.interface === interfaceId)
            .map((item) => ({ id: item.id, provider: item.source })),
      },
      "@antelopejs/interface-core/logging": { Logging: log.Logging },
      "@antelopejs/interface-core/modules": {
        ListModules: async () => Object.keys(modules),
        /** @param {string} id */
        GetModuleInfo: async (id) => ({
          localPath: `/modules/${id}`,
          config: modules[id]?.config,
        }),
        ListModuleDeclarations: () => listModuleDeclarations(dir),
      },
      "node:fs/promises": withPackageJsons(
        (id) => installed.get(id) ?? modules[id]?.source.package,
      ),
      "@antelopejs/interface-dms-builder": {
        ListEntryConnections,
        GetDatabaseProject: async () => ({
          ok: true,
          data: {
            modules: Object.keys(modules),
            self: "dms",
            databasePins: [],
            drivers: {},
          },
          changes: [],
        }),
        /** @param {unknown} steps */
        ConfigureProject: async (steps) => configureProject(steps),
      },
    };
  }

  return {
    dir,
    text: () => fs.readFileSync(file, "utf8"),
    modules: loaded,
    declarations: () => listModuleDeclarations(dir),
    /** @param {string} id */
    async connections(id) {
      readByCore(await loaded());
      return inFolder(dir, () => ListEntryConnections(id));
    },
    /** @param {string} [cwd] */
    async start(cwd = dir) {
      const modules = await loaded();
      await inFolder(cwd, async () => {
        readByCore(modules);
        const restore = interceptRequire(
          options.typescript === false
            ? { ...mocks(modules), typescript: NOT_INSTALLED }
            : mocks(modules),
          false,
          module,
        );
        try {
          forgetBuiltModules();
          await MoveSchema.parse(require(MOVE_PATH)).moveLegacyBuilderSettings(
            dir,
          );
        } finally {
          restore();
        }
      });
    },
    /** @param {string} [cwd] */
    async sourceFolder(cwd = dir) {
      const modules = await loaded();
      return inFolder(cwd, () => {
        readByCore(modules);
        return resolveProjectRoot();
      });
    },
    notices: log.notices,
    warnings: log.warnings,
    verdicts: log.verdicts,
  };
}

module.exports = { realProject };
