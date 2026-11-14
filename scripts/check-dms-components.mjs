import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Fails when a `.vue` file of the repository uses a `Dms…` or `dms-…` tag that names no component:
 * neither one the installed `@antelopejs/dms` layers ship nor one this module registers. Vue renders
 * an unknown tag as nothing, and neither the typecheck nor a test sees it, so a component the DMS
 * renames would otherwise leave a blank space on a page.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const FRONTEND = path.join(ROOT, "frontend-vue");
const DMS_PREFIX = "Dms";
const MODULE_PREFIX = "DmsAi";
const VUE_FILE = /\.vue$/;
const TAG = /<(Dms[A-Z][A-Za-z0-9]*|dms-[a-z0-9]+(?:-[a-z0-9]+)*)(?=[\s/>])/g;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function vueFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && VUE_FILE.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * @param {string} dir
 * @param {string} prefix
 * @returns {string[]}
 */
function componentNames(dir, prefix) {
  return vueFiles(dir).map((file) => `${prefix}${path.basename(file, ".vue")}`);
}

/**
 * @param {string} tag
 * @returns {string}
 */
function pascal(tag) {
  return tag.startsWith("dms-")
    ? tag
        .split("-")
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join("")
    : tag;
}

/** @returns {string[]} */
function dmsLayerComponents() {
  const require = createRequire(path.join(FRONTEND, "package.json"));
  const dms = path.dirname(
    realpathSync(require.resolve("@antelopejs/dms/package.json")),
  );
  const layers = path.join(dms, "frontend-vue", "layers");
  return readdirSync(layers).flatMap((layer) => {
    const dir = path.join(layers, layer, "app", "components");
    try {
      return componentNames(dir, DMS_PREFIX);
    } catch {
      return [];
    }
  });
}

const known = new Set([
  ...dmsLayerComponents(),
  ...componentNames(path.join(FRONTEND, "app", "components"), MODULE_PREFIX),
]);

const tracked = execFileSync("git", ["ls-files", "*.vue"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => file !== "");

const unknown = tracked.flatMap((file) =>
  [...readFileSync(path.join(ROOT, file), "utf8").matchAll(TAG)]
    .map((match) => match[1])
    .filter((tag) => !known.has(pascal(tag)))
    .map(
      (tag) =>
        `${file}: <${tag}> names no component of @antelopejs/dms or of this module`,
    ),
);

if (unknown.length > 0) {
  console.error([...new Set(unknown)].join("\n"));
  process.exit(1);
}
