import { testTimeouts } from "@antelopejs/tooling-configs/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...testTimeouts,
    isolate: false,
    setupFiles: ["tests/helpers/setup-chatgpt.ts"],
  },
});
