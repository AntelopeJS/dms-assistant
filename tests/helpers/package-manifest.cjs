const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

const ROOT = path.resolve(__dirname, "../..");

const ManifestSchema = z.object({
  main: z.string(),
  types: z.string(),
  dmsFrontend: z.string(),
  exports: z.record(z.string(), z.unknown()),
  antelopeJs: z.object({ skills: z.array(z.string()) }),
  peerDependencies: z.object({ "@openai/codex": z.string() }),
});

/**
 * The fields of the root `package.json` that say what a project installs.
 *
 * @returns {z.infer<typeof ManifestSchema>} The parsed manifest
 */
function readManifest() {
  return ManifestSchema.parse(
    JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")),
  );
}

/**
 * @returns {string[]} The folders under `skills/`, one per skill the package ships
 */
function skillFolders() {
  return fs.readdirSync(path.join(ROOT, "skills"));
}

/**
 * @param {string} file A documentation file, relative to the repository root
 * @returns {string} Its text
 */
function readDoc(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

module.exports = { readDoc, readManifest, skillFolders };
