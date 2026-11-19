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
function packedPaths() {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const [pack] = PackSchema.parse(JSON.parse(result.stdout));
  return pack.files.map((file) => file.path);
}

void test("the published package carries no test file", () => {
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

void test("the package leaves out the tests, docs sources, playgrounds and agent folders", () => {
  assert.deepEqual(
    packedPaths().filter((file) => UNSHIPPED_FOLDER.test(file)),
    [],
  );
});

void test("the manifest declares the dashboard layer, the skills, an exact Codex pin and only the root export", () => {
  const declared = readManifest();
  assert.equal(declared.dmsFrontend, "dist/frontend-module.js");
  assert.deepEqual(declared.antelopeJs.skills, ["./skills"]);
  assert.match(declared.peerDependencies["@openai/codex"], /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(declared.exports), [".", "./package.json"]);
});

void test("the README and the extending guide name every skill folder the package ships", () => {
  const folders = skillFolders();
  for (const doc of ["README.md", "docs/5.extending.md"]) {
    const text = readDoc(doc);
    assert.deepEqual(
      folders.filter((name) => !text.includes(`\`${name}\``)),
      [],
      doc,
    );
  }
});
