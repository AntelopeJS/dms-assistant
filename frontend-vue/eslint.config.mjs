import dmsGlobals from "@antelopejs/dms/eslint-globals";
import dmsFrontendGlobals from "@antelopejs/dms-frontend/eslint-globals";
import { antelopeNuxtConfig } from "@antelopejs/tooling-configs/eslint";
import globals from "globals";
import vue from "eslint-plugin-vue";

export default antelopeNuxtConfig({
	rules: {
		"vue/multi-word-component-names": "error",
		"no-undef": "error",
		"constructor-super": "error",
		"getter-return": "error",
		"no-class-assign": "error",
		"no-const-assign": "error",
		"no-dupe-args": "error",
		"no-dupe-class-members": "error",
		"no-dupe-keys": "error",
		"no-empty": "error",
		"no-empty-character-class": "error",
		"no-func-assign": "error",
		"no-import-assign": "error",
		"no-invalid-regexp": "error",
		"no-new-native-nonconstructor": "error",
		"no-obj-calls": "error",
		"no-redeclare": "error",
		"no-setter-return": "error",
		"no-this-before-super": "error",
		"no-unreachable": "error",
		"no-unsafe-negation": "error",
		"no-useless-backreference": "error",
		"no-with": "error",
		"valid-typeof": "error",
	},
}).append(
	{
		files: ["**/*.ts"],
		rules: Object.assign(
			{},
			...vue.configs["flat/essential"].map((config) => config.rules ?? {}),
		),
	},
	{
		files: ["**/*.{ts,vue}"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				...dmsFrontendGlobals,
				...dmsGlobals,
			},
		},
	},
);
