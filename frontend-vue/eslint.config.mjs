import dmsGlobals from "@antelopejs/dms/eslint-globals";
import dmsFrontendGlobals from "@antelopejs/dms-frontend/eslint-globals";
import { antelopeNuxtConfig } from "@antelopejs/tooling-configs/eslint";

export default antelopeNuxtConfig().append({
	files: ["**/*.{ts,vue}"],
	languageOptions: {
		globals: { ...dmsFrontendGlobals, ...dmsGlobals },
	},
	rules: { "no-undef": "error" },
});
