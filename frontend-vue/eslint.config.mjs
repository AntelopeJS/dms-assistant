import dmsGlobals from "@antelopejs/dms/eslint-globals";
import dmsFrontendGlobals from "@antelopejs/dms-frontend/eslint-globals";
import { antelopeNuxtConfig } from "@antelopejs/tooling-configs/eslint";
import globals from "globals";

export default antelopeNuxtConfig({
	rules: {
		"vue/multi-word-component-names": "error",
		"no-undef": "error",
	},
}).append({
	files: ["**/*.{ts,vue}"],
	languageOptions: {
		globals: {
			...globals.browser,
			...globals.node,
			...dmsFrontendGlobals,
			...dmsGlobals,
		},
	},
});
