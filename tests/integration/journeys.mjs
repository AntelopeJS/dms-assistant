import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { startRun } from "@antelopejs/dms/e2e/run";

/** @typedef {import("@antelopejs/dms/e2e").Journey} Journey */
/** @typedef {import("@antelopejs/dms/e2e/run").StartedRun} StartedRun */
/** @typedef {import("@antelopejs/dms/e2e/run").RunOptions} RunOptions */
/** @typedef {{ name: string, detail: string, verdict: "pass" | "fail" | "known" | "fixed", finding?: string }} JudgedCheck */
/** @typedef {{ error: string | null, steps: { name: string, checks: JudgedCheck[] }[] }} JourneyResult */

const KIT = dirname(
  createRequire(import.meta.url).resolve("@antelopejs/dms/e2e/run"),
);
/** @typedef {(state: StartedRun["run"], feature: string, journey: Journey, skill: undefined, browser: unknown) => Promise<JourneyResult>} RunJourney */

/**
 * @param {unknown} kit The kit module that drives one journey
 * @returns {kit is { runJourney: RunJourney }} True when it exports `runJourney`
 */
function isJourneyRunner(kit) {
  return (
    typeof kit === "object" &&
    kit !== null &&
    "runJourney" in kit &&
    typeof kit.runJourney === "function"
  );
}

/** @type {unknown} */
const journeyRun = await import(
  pathToFileURL(join(KIT, "journey-run.mjs")).href
);
if (!isJourneyRunner(journeyRun))
  throw new Error(`${KIT}/journey-run.mjs exports no runJourney`);
const { runJourney } = journeyRun;

const MINUTE = 60_000;
const RUN_TIMEOUT_MS = 30 * MINUTE;
const JOURNEY_TIMEOUT_MS = 10 * MINUTE;

/** The browser of a journey that must open no tab: a `ctx.tab()` call fails the journey. */
const NO_BROWSER = {
  newContext() {
    throw new Error(
      "an integration journey opens no tab: it belongs in the Playwright suite",
    );
  },
};

/**
 * Starts one run of a journeys suite's playground, then runs each feature's journeys as tests, each on a fresh database
 * of that run as the Playwright suite runs it. A test fails on a failed check, on a check of the journey's
 * `knownFailures` that passes, and on an error; a known failure shows as a diagnostic.
 *
 * @param {RunOptions} options How `startRun` starts the suite's run
 * @param {Record<string, Journey[]>} features The journeys of each feature
 */
export function journeySuite(options, features) {
  /** @type {StartedRun | undefined} */
  let started;
  before(
    async () => {
      started = await startRun(options);
    },
    { timeout: RUN_TIMEOUT_MS },
  );
  after(async () => {
    await started?.stop();
  });
  for (const [feature, journeys] of Object.entries(features)) {
    void describe(feature, () => {
      for (const journey of journeys) {
        void test(journey.id, { timeout: JOURNEY_TIMEOUT_MS }, async (t) => {
          assert.ok(started, "the run started");
          const result = await runJourney(
            started.run,
            feature,
            journey,
            undefined,
            NO_BROWSER,
          );
          const checks = result.steps.flatMap((step) =>
            step.checks.map((check) => ({ step: step.name, ...check })),
          );
          for (const check of checks.filter(
            ({ verdict }) => verdict === "known",
          )) {
            t.diagnostic(`known failure: ${check.name}: ${check.finding}`);
          }
          const failed = checks
            .filter(({ verdict }) => verdict === "fail" || verdict === "fixed")
            .map(
              (check) =>
                `${check.step} › ${check.name} [${check.verdict}]: ${check.detail}`,
            );
          assert.deepEqual(
            { error: result.error, failed },
            { error: null, failed: [] },
          );
        });
      }
    });
  }
}
