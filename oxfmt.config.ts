import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/**
 * The Vue layer keeps Prettier; the Codex protocol types are generated; the
 * journeys, their helpers and the e2e playground keep their one-line journey style.
 */
export default antelopeFmtPreset({
  ignorePatterns: [
    "frontend-vue/**",
    "**/*.md",
    "**/*.vue",
    "sidecar/src/providers/codex/protocol/**",
    "e2e/journeys/**",
    "e2e/*.mjs",
    "e2e/playground/**",
    "e2e/builder/journeys/**",
    "e2e/builder/*.mjs",
    "e2e/builder/playground/**",
  ],
});
