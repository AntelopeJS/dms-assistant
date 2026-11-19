/**
 * Splits a feature's journeys by where they run: `journeys` open a dashboard tab and run in the Playwright suite,
 * `integrationJourneys` (marked `integration: true`) only call the API or read files and run as node:test files under
 * `tests/integration`.
 *
 * @template {{ integration?: boolean }} Journey
 * @param {Journey[]} all The journeys of a feature
 * @returns {{ journeys: Journey[], integrationJourneys: Journey[] }} The journeys of each runner
 */
export function byRunner(all) {
  return {
    journeys: all.filter((journey) => journey.integration !== true),
    integrationJourneys: all.filter((journey) => journey.integration === true),
  };
}
