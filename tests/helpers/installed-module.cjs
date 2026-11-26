const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdtemp, readdir, readFile, rm } = require("node:fs/promises");
const { builtinModules } = require("node:module");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { z } = require("zod");

const CoreOutputSchema = z.object({
  getModuleCacheInstallCommand: z.function({
    input: [z.string()],
    output: z.unknown(),
  }),
});
const ManifestSchema = z.object({ packageManager: z.string().optional() });
const ROOT = path.resolve(__dirname, "..", "..");
const BUILTINS = new Set(builtinModules);
const SPECIFIER =
  /(?<![\w"'$.])(?:from|import|require\s*\(|import\s*\()\s*["']([@\w][\w@./+-]*)["']/g;

/**
 * The environment without the `npm_config_*` and `pnpm_config_*` settings a
 * `pnpm run` of this repository exports, such as its `minimumReleaseAge`
 * without its `minimumReleaseAgeExclude`. The module cache installs from the
 * host's environment, which holds none of them.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function hostEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^p?npm_config_/i.test(name),
    ),
  );
}

/**
 * Runs `command` in `cwd` with the host's environment and throws with its
 * output when it fails.
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {string}
 */
function run(command, cwd) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: hostEnv(),
  });
  if (result.status === 0) return result.stdout;
  throw new Error(
    `${command} failed in ${cwd} (${result.status}):\n${result.stdout}\n${result.stderr}`,
  );
}

/**
 * The command the AntelopeJS module cache runs in a module's cache folder,
 * as the `@antelopejs/core` this repository pins builds it.
 *
 * @param {string} folder
 * @returns {Promise<string>}
 */
async function moduleCacheInstallCommand(folder) {
  const core = path.dirname(require.resolve("@antelopejs/core/package.json"));
  const { getModuleCacheInstallCommand } = CoreOutputSchema.parse(
    require(path.join(core, "dist", "core", "output", "package-manager.js")),
  );
  return z.string().parse(await getModuleCacheInstallCommand(folder));
}

/**
 * Packs this module as the release publishes it, with `npm pack`, and
 * installs the tarball the way the module cache does: extracted into a folder
 * of its own, then installed there as the root project, production
 * dependencies only, with the package manager its `packageManager` names.
 * Throws when the tarball does not name the root's `packageManager`, which
 * would send the install down another package manager's path.
 *
 * @returns {Promise<{ scratch: string; folder: string }>}
 */
async function installAsTheModuleCache() {
  const scratch = await mkdtemp(
    path.join(tmpdir(), "dms-assistant-installed-"),
  );
  try {
    const packed = run(`npm pack --pack-destination "${scratch}"`, ROOT)
      .trim()
      .split("\n")
      .at(-1)
      ?.trim();
    if (packed === undefined) throw new Error("npm pack printed no tarball");
    run(`tar -xzf "${path.resolve(scratch, packed)}"`, scratch);
    const folder = path.join(scratch, "package");
    const [shipped, own] = await Promise.all(
      [folder, ROOT].map(async (dir) =>
        ManifestSchema.parse(
          JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")),
        ),
      ),
    );
    if (shipped.packageManager !== own.packageManager)
      throw new Error(
        `the tarball names packageManager ${shipped.packageManager}, not ${own.packageManager}`,
      );
    run(await moduleCacheInstallCommand(folder), folder);
    return { scratch, folder };
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Every `.js` file under `dir`.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function scripts(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * The package a bare specifier names: its scope and name.
 *
 * @param {string} specifier
 * @returns {string}
 */
function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Whether Node finds `name` from `file`: a `node_modules/<name>` in the
 * file's folder or one above it.
 *
 * @param {string} name
 * @param {string} file
 * @returns {boolean}
 */
function findsPackage(name, file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "node_modules", name, "package.json")))
      return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/**
 * The packages the installed module's built files import that Node cannot
 * find from where they are imported, as `<file>: <specifier>`.
 *
 * @param {string} folder
 * @param {string[]} builtDirs
 * @returns {Promise<string[]>}
 */
async function unresolvedImports(folder, builtDirs) {
  const missing = [];
  for (const dir of builtDirs) {
    for (const file of await scripts(path.join(folder, dir))) {
      const text = await readFile(file, "utf8");
      for (const [, specifier] of text.matchAll(SPECIFIER)) {
        const name = packageName(specifier);
        if (specifier.startsWith("node:") || BUILTINS.has(name)) continue;
        if (!findsPackage(name, file))
          missing.push(`${path.relative(folder, file)}: ${specifier}`);
      }
    }
  }
  return [...new Set(missing)];
}

module.exports = { installAsTheModuleCache, unresolvedImports };
