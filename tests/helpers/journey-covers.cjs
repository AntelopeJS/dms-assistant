const { execFileSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");

const JourneysModuleSchema = z.object({ covers: z.array(z.string()) });

/**
 * @param {string} root The repository root
 * @returns {string[]} The paths git tracks, relative to the root
 */
function trackedFiles(root) {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/**
 * The `covers` globs each journeys module of a suite exports.
 *
 * @param {string} root The repository root
 * @param {string} journeys The suite's journeys folder, relative to the root
 * @returns {Promise<{ file: string, covers: string[] }[]>} One entry per `*.mjs` module, its path relative to the root
 * @throws When a module exports no `covers` array of globs
 */
async function journeyCovers(root, journeys) {
  const folder = path.join(root, journeys);
  return Promise.all(
    readdirSync(folder)
      .filter((file) => file.endsWith(".mjs"))
      .map(async (file) => {
        /** @type {unknown} */
        const loaded = await import(
          pathToFileURL(path.join(folder, file)).href
        );
        const parsed = JourneysModuleSchema.safeParse(loaded);
        if (!parsed.success)
          throw new Error(
            `${journeys}/${file} exports no covers array of globs`,
          );
        return { file: `${journeys}/${file}`, covers: parsed.data.covers };
      }),
  );
}

module.exports = { journeyCovers, trackedFiles };
