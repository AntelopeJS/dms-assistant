const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { z } = require("zod");
const { moveLog } = require("./move-log.cjs");
const { interceptRequire } = require("./intercept-require.cjs");

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

const PROJECT_ROOT = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "legacy-project-")),
);
fs.writeFileSync(
  path.join(PROJECT_ROOT, "antelope.config.ts"),
  'export default { name: "app", modules: {} };\n',
);

/**
 * @typedef {{ interface: string, source?: string, id?: string }} Override
 * @typedef {{ package: string, config: Record<string, unknown>, importOverrides: Override[], disabled?: boolean, loaded?: boolean }} Entry
 * @typedef {Record<string, Entry>} Entries
 * @typedef {{ op: string, id?: string, interface?: string, entry?: { importOverrides?: Override[], config?: Record<string, unknown> } }} Step
 * @typedef {{ ok: true, data: { files: string[] }, changes: [] } | { ok: false, error: { code: "invalid_config", issues: { pointer: string, message: string }[] } | { code: "unsupported", detail: string } }} Answer
 */

const DATABASE_INTERFACES = new Set([
  "@antelopejs/interface-database",
  "@antelopejs/interface-database-catalog",
]);

const RecordSchema = z.record(z.string(), z.unknown());

const AccessSchema = z
  .object({
    config: z.object({
      externalConnections: z.record(
        z.string(),
        z.object({ access: z.string() }).partial(),
      ),
    }),
  })
  .transform(({ config }) => config.externalConnections)
  .catch({});

/**
 * Answers as @antelopejs/dms's `ListEntryConnections` does for this in-memory project: the
 * database bindings an entry declares, loaded or not, each connection with the access dms-database
 * grants it, and `not_found` on demand for an entry the project declares, which a real file cannot
 * produce while ConfigureProject still writes it.
 *
 * @param {Entries} entries
 * @param {string} id
 * @param {{ notFound?: string[] }} options
 */
function entryConnections(entries, id, options) {
  const entry = Object.hasOwn(entries, id) ? entries[id] : undefined;
  if (entry === undefined || options.notFound?.includes(id)) {
    return { ok: false, error: { code: "not_found", ref: id } };
  }
  const granted = AccessSchema.parse(entries["dms-database"]);
  return {
    ok: true,
    data: entry.importOverrides
      .filter((item) => DATABASE_INTERFACES.has(item.interface))
      .map((item) =>
        item.id === undefined
          ? item
          : {
              ...item,
              access:
                granted[item.id]?.access === "read-write"
                  ? "read-write"
                  : "read",
            },
      ),
    changes: [],
  };
}

/** @param {Entry} entry */
const isLoaded = (entry) => entry.loaded ?? entry.disabled !== true;

const MoveSchema = z.object({
  moveLegacyBuilderSettings: z.function({
    input: [z.string()],
    output: z.promise(z.void()),
  }),
});

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function merged(target, patch) {
  /** @type {Record<string, unknown>} */
  const next = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const current = RecordSchema.safeParse(next[key]);
    const added = RecordSchema.safeParse(value);
    next[key] =
      current.success && added.success
        ? merged(current.data, added.data)
        : value;
  }
  return next;
}

/** @param {string} message */
function refused(message) {
  return new Error(message);
}

/**
 * @param {Entries} entries
 * @param {Step[]} steps
 * @returns {Entries}
 */
function applied(entries, steps) {
  /** @type {Entries} */
  const next = structuredClone(entries);
  for (const step of steps) {
    if (step.op === "RemoveConnection") {
      const holders = Object.values(next).filter((entry) =>
        entry.importOverrides.some(
          (item) => item.interface === step.interface && item.id === step.id,
        ),
      );
      if (holders.length === 0) {
        throw refused(
          `no module has a connection "${step.id}" to ${step.interface}`,
        );
      }
      for (const entry of holders) {
        entry.importOverrides = entry.importOverrides.filter(
          (item) => !(item.interface === step.interface && item.id === step.id),
        );
      }
    } else if (step.op === "ConfigureModule" && step.id !== undefined) {
      const entry = next[step.id];
      if (entry === undefined) throw refused(`could not find ${step.id}`);
      for (const item of step.entry?.importOverrides ?? []) {
        if (
          entry.importOverrides.some(
            (held) => held.interface === item.interface && held.id === item.id,
          )
        ) {
          throw refused(`${step.id} declares "${item.id}" twice`);
        }
        entry.importOverrides.push(item);
      }
      entry.config = merged(entry.config, step.entry?.config ?? {});
    } else {
      throw refused(`unexpected step ${step.op}`);
    }
  }
  return next;
}

/** @param {() => Entries} entries */
function coreMocks(entries) {
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
        (responsible === undefined || !isLoaded(entries()[responsible])
          ? []
          : (entries()[responsible]?.importOverrides ?? [])
        )
          .filter((item) => item.interface === interfaceId)
          .map((item) => ({
            id: item.id,
            provider: item.source,
            path: "",
            selected: false,
          })),
    },
    "@antelopejs/interface-core/modules": {
      ListModules: async () =>
        Object.keys(entries()).filter((id) => isLoaded(entries()[id])),
      /** @param {string} id */
      GetModuleInfo: async (id) => ({
        localPath: `/modules/${id}`,
        config: entries()[id]?.config,
      }),
      ListModuleDeclarations: async () =>
        Object.fromEntries(
          Object.entries(entries()).map(([id, entry]) => [
            id,
            {
              source: {
                type: "package",
                package: entry.package,
                version: "*",
              },
              config: entry.config,
              disabled: entry.disabled,
            },
          ]),
        ),
    },
    "node:fs/promises": {
      ...fs.promises,
      /**
       * @param {string} file
       * @param {BufferEncoding} encoding
       */
      readFile: async (file, encoding) => {
        if (!file.split(path.sep).join("/").startsWith("/modules/")) {
          return fs.promises.readFile(file, encoding);
        }
        const entry = entries()[path.basename(path.dirname(file))];
        if (entry === undefined) throw new Error(`ENOENT ${file}`);
        return JSON.stringify({ name: entry.package });
      },
    },
  };
}

/**
 * @param {Entries} initial
 * @param {{ self?: string, refusal?: Answer, cwd?: string, notFound?: string[] }} [options]
 */
function legacyProject(initial, options = {}) {
  const self = options.self ?? "dms";
  let entries = structuredClone(initial);
  /** @type {Step[][]} */
  const batches = [];
  let projectReads = 0;
  const log = moveLog();

  const mocks = {
    "@antelopejs/interface-core/logging": { Logging: log.Logging },
    ...coreMocks(() => entries),
    "@antelopejs/interface-dms-builder": {
      /** @param {string} id */
      ListEntryConnections: async (id) =>
        entryConnections(entries, id, options),
      GetDatabaseProject: async () => {
        projectReads += 1;
        return {
          ok: true,
          data: {
            modules: Object.keys(entries),
            self,
            databasePins: [],
            drivers: {},
          },
          changes: [],
        };
      },
      /** @param {Step[]} steps */
      ConfigureProject: async (steps) => {
        batches.push(steps);
        if (options.refusal !== undefined) return options.refusal;
        try {
          entries = applied(entries, steps);
        } catch (error) {
          return {
            ok: false,
            error: {
              code: "invalid_config",
              issues: [
                {
                  pointer: "",
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              ],
            },
          };
        }
        return {
          ok: true,
          data: { files: ["antelope.config.ts"] },
          changes: [],
        };
      },
    },
  };

  return {
    async start() {
      const previous = process.cwd();
      process.chdir(options.cwd ?? PROJECT_ROOT);
      const restore = interceptRequire(mocks, false, module);
      try {
        forgetBuiltModules();
        await MoveSchema.parse(require(MOVE_PATH)).moveLegacyBuilderSettings(
          PROJECT_ROOT,
        );
      } finally {
        restore();
        process.chdir(previous);
      }
    },
    entries: () => entries,
    batches,
    projectReads: () => projectReads,
    notices: log.notices,
    warnings: log.warnings,
    verdicts: log.verdicts,
  };
}

module.exports = { legacyProject, PROJECT_ROOT };
