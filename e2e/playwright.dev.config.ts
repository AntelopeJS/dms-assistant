import { defineConfig } from "@playwright/test";
import { e2eConfig } from "@antelopejs/dms/e2e";

/**
 * The journeys that only the development dashboard serves, on one worker: a
 * watch backend loads the checkout's `e2e/playground/src`, not its run's copy,
 * so a journey that writes there reloads the watch backend of every other run.
 */
export default defineConfig(e2eConfig({ frontend: "dev" }), {
  testIgnore: ["builder/**"],
  workers: 1,
});
