const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");
const {
  readDoc,
  readManifest,
  skillFolders,
} = require("./helpers/package-manifest.cjs");

const ROOT = path.resolve(__dirname, "..");
const PackSchema = z.array(
  z.object({ files: z.array(z.object({ path: z.string() })) }),
);
const TEST_ONLY_FILE =
  /(^|\/)tests\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)vitest[^/]*\.config\.[cm]?[jt]s$/;

/**
 * The paths `npm pack` would put in the tarball, without running the
 * `prepack` build.
 *
 * @returns {string[]}
 */
function pack() {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const [pack] = PackSchema.parse(JSON.parse(result.stdout));
  return pack.files.map((file) => file.path);
}

const PACKED = pack();

/** @returns {string[]} */
function packedPaths() {
  return PACKED;
}

void test("the published package carries no test file (fails a files list that packs tests/ or a spec)", () => {
  const packed = packedPaths();
  assert.ok(packed.includes("frontend-vue/dms.frontend.ts"));
  assert.deepEqual(
    packed.filter((file) => TEST_ONLY_FILE.test(file)),
    [],
  );
});

const SHIPPED_SKILL_FILE =
  /^skills\/dms-assistant(-code-mode)?\/(SKILL\.md|cases\.json)$/;
const UNSHIPPED_FOLDER =
  /^(tests|docs|playground|e2e|\.agents|\.campaign|sidecar\/(src|tests))\//;

void test("the package holds the entry points the manifest declares and the dashboard layer (fails a files list that drops dist or frontend-vue)", () => {
  const packed = packedPaths();
  const { main, types } = readManifest();
  assert.deepEqual(
    [main, types, "frontend-vue/dms.frontend.ts"].filter(
      (file) => !packed.includes(file),
    ),
    [],
  );
  assert.ok(packed.some((file) => file.startsWith("frontend-vue/app/chat/")));
});

void test("the package ships the chat's two skills and nothing else under skills (fails when a builder skill or a stray file is packed)", () => {
  const packed = packedPaths().filter((file) => file.startsWith("skills/"));
  assert.deepEqual(
    packed.filter((file) => !SHIPPED_SKILL_FILE.test(file)),
    [],
  );
  assert.deepEqual(
    [
      "skills/dms-assistant/SKILL.md",
      "skills/dms-assistant-code-mode/SKILL.md",
    ].filter((file) => !packed.includes(file)),
    [],
  );
});

void test("the package leaves out the tests, docs sources, playgrounds and agent folders (fails a files list that names one of them)", () => {
  assert.deepEqual(
    packedPaths().filter((file) => UNSHIPPED_FOLDER.test(file)),
    [],
  );
});

void test("the manifest declares the dashboard layer, the skills, a bounded Codex peer range and only the root export (fails an open-ended range on the Codex peer or a new subpath export)", () => {
  const declared = readManifest();
  assert.equal(declared.dmsFrontend, "dist/frontend-module.js");
  assert.deepEqual(declared.antelopeJs.skills, ["./skills"]);
  assert.match(
    declared.peerDependencies["@openai/codex"],
    /^>=\d+\.\d+\.\d+ <\d+\.0\.0$/,
  );
  assert.deepEqual(Object.keys(declared.exports), [".", "./package.json"]);
});

void test("the README and the extending guide name every skill folder the package ships (fails a new skill folder neither document names)", () => {
  const folders = skillFolders();
  for (const doc of ["README.md", "docs/8.extending.md"]) {
    const text = readDoc(doc);
    assert.deepEqual(
      folders.filter((name) => !text.includes(`\`${name}\``)),
      [],
      doc,
    );
  }
});
