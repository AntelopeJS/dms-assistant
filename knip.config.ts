import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

/**
 * Knip config for the root package. `@anthropic-ai/claude-code` is resolved from
 * node_modules at runtime as an executable and never imported. The published
 * sidecar uses the root's runtime dependencies, so the SDK, MCP and zod
 * dependencies are ignored here: knip assigns their imports to the sidecar
 * workspace, which is checked separately. Nested package dependencies are
 * checked from their own manifests, so `frontend-vue` and `sidecar` stay
 * separate workspaces with their own development manifests. The e2e kit loads
 * the journeys modules by path, so they are entries.
 */
export default {
  workspaces: {
    ".": antelopeKnipConfig({
      ignoreDependencies: [
        "@anthropic-ai/claude-code",
        "@anthropic-ai/claude-agent-sdk",
        "@modelcontextprotocol/sdk",
        "zod",
      ],
      entry: ["e2e/journeys/*.mjs", "e2e/builder/journeys/*.mjs"],
      project: ["e2e/**/*.mjs"],
      ignore: ["frontend-vue/**", "sidecar/tests/**"],
    }),
  },
  ignoreWorkspaces: ["frontend-vue", "sidecar"],
};
