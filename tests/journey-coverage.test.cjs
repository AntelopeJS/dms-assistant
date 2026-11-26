const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { journeyCovers, trackedFiles } = require("./helpers/journey-covers.cjs");

const ROOT = path.resolve(__dirname, "..");

/**
 * @typedef {{ journeys: string, smoke: string, userFacing: string[], notUserFacing: string[] }} Suite A journeys suite: its
 * journeys folder, its smoke feature, which needs no covers, and the files its features must cover
 */

/** @type {Record<string, Suite>} */
const SUITES = {
  assistant: {
    journeys: "e2e/journeys",
    smoke: "smoke",
    userFacing: [
      "src/**",
      "sidecar/src/**",
      "frontend-vue/**",
      "skills/**",
      "package.json",
      "sidecar/package.json",
    ],
    notUserFacing: [
      "frontend-vue/tests/**",
      "frontend-vue/eslint.config.mjs",
      "frontend-vue/vitest.config.ts",
      "frontend-vue/pnpm-lock.yaml",
      "frontend-vue/pnpm-workspace.yaml",
      "frontend-vue/tsconfig.chat.json",
      "frontend-vue/tsconfig.tests.json",
      "frontend-vue/tsconfig.json",
      "frontend-vue/.*",
      "src/builder/**",
      "frontend-vue/builder/**",
      "frontend-vue/i18n/locales/builder-*.json",
    ],
  },
  builder: {
    journeys: "e2e/builder/journeys",
    smoke: "smoke",
    userFacing: [
      "src/builder/**",
      "frontend-vue/builder/**",
      "frontend-vue/i18n/locales/builder-*.json",
    ],
    notUserFacing: [
      "src/builder/test/**",
      "frontend-vue/builder/tests/**",
      "frontend-vue/builder/vitest.config.ts",
    ],
  },
};

/**
 * @param {string} file A repository path
 * @param {string[]} globs Globs relative to the repository root
 * @returns {boolean} Whether a glob matches the path
 */
function matches(file, globs) {
  return globs.some((glob) => path.matchesGlob(file, glob));
}

const tracked = trackedFiles(ROOT);

for (const [name, suite] of Object.entries(SUITES)) {
  void test(`every user-facing file of the ${name} suite is covered by a journeys module, and every covers glob matches a tracked file (fails a source file no feature covers)`, async () => {
    const features = await journeyCovers(ROOT, suite.journeys);
    const problems = [];
    for (const feature of features) {
      if (
        feature.covers.length === 0 &&
        feature.file !== `${suite.journeys}/${suite.smoke}.mjs`
      ) {
        problems.push(`${feature.file}: lists no covers globs`);
      }
      for (const glob of feature.covers) {
        if (!tracked.some((file) => path.matchesGlob(file, glob)))
          problems.push(
            `${feature.file}: glob ${glob} matches no tracked file`,
          );
      }
    }
    const covers = features.flatMap((feature) => feature.covers);
    for (const file of tracked) {
      if (
        matches(file, suite.userFacing) &&
        !matches(file, suite.notUserFacing) &&
        !matches(file, covers)
      ) {
        problems.push(
          `${file}: no journeys module of ${suite.journeys} covers it`,
        );
      }
    }
    assert.deepEqual(problems, []);
  });
}
