import { defineConfig } from "vitest/config";

/**
 * On Windows, writing a credential file starts Windows PowerShell to set its
 * DACL, and a cold start on a busy runner takes seconds, so a test or hook
 * that writes one gets more room there than vitest's defaults.
 */
const WINDOWS_TIMEOUT_MS = 30_000;
const isWindows = process.platform === "win32";

export default defineConfig({
  test: {
    isolate: false,
    setupFiles: ["tests/helpers/setup-chatgpt.ts"],
    ...(isWindows && {
      testTimeout: WINDOWS_TIMEOUT_MS,
      hookTimeout: WINDOWS_TIMEOUT_MS,
    }),
  },
});
