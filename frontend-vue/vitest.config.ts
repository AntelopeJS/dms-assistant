import { resolve } from "node:path";
import { testTimeouts } from "@antelopejs/tooling-configs/vitest";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { backendBoundary } from "./build/backend-boundary.ts";

export default defineConfig({
	plugins: [backendBoundary(), vue()],
	resolve: {
		alias: {
			/** The renderer's runtime exists in the generated application only. */
			"#dms/frontend-module": resolve(
				__dirname,
				"tests/support/dms-frontend-module.ts",
			),
			"#dms-core": resolve(
				__dirname,
				"node_modules/@antelopejs/dms/frontend-vue/layers/dms-core",
			),
			"#dms-ui": resolve(
				__dirname,
				"node_modules/@antelopejs/dms/frontend-vue/layers/dms-ui",
			),
		},
	},
	test: {
		...testTimeouts,
		/**
		 * Most suites need no DOM, and setting jsdom up per file is the bulk of
		 * the run; the files that mount components opt in with a
		 * `@vitest-environment jsdom` header.
		 */
		environment: "node",
		include: ["tests/**/*.test.ts"],
		setupFiles: ["tests/support/setup-layout.ts"],
	},
});
