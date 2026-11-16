import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/**
 * The Vue layer keeps Prettier; the Codex protocol types are generated; the
 * journeys, their helpers and the e2e playground keep the verify skill's style.
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
  ],
});
