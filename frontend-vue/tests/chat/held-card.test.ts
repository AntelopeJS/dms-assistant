// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PermissionCard from "../../app/chat/components/PermissionCard.vue";
import { CHAT_I18N_KEY } from "../../app/chat/composables/useChatI18n";
import type { PermissionRequestData } from "../../app/chat/types/permission";
import en from "../../i18n/locales/dms-ai-panel-en-GB.json";
import fr from "../../i18n/locales/dms-ai-panel-fr-FR.json";
import { createTestI18n } from "../support/i18n";
import { PANEL_STUBS } from "../support/stubs";

const OTHER_MAP_ARGS = {
	module: "shop",
	connection: "pg-main",
	resources: [{ relation: "public.items" }],
};

const OTHER_MAP_REQUEST: PermissionRequestData = {
	requestId: "r6",
	conversationId: "conv-held-card",
	callId: "c6",
	toolName: "mcp__dms__builder_map_resources",
	args: OTHER_MAP_ARGS,
	summary: "Map database tables",
	kind: "builder",
	alwaysAsk: false,
	preview: {
		type: "held_tool",
		operation: "builder_map_resources",
		args: OTHER_MAP_ARGS,
	},
	ruleOptions: [],
	createdAtMs: 0,
	expiresAtMs: 0,
};

const CONFIGURE_DIFF = `--- a/antelope.config.ts\n+++ b/antelope.config.ts\n@@ -1,3 +1,9 @@\n${"+    dms: { config: { mcp: { enabled: true } } },\n".repeat(6)}`;

const CONFIGURE_STEPS = [
	{
		action: "ConfigureModule",
		module: "@antelopejs/dms",
		config: { externalConnections: { erp: { access: "read" } } },
	},
];

const CONFIGURE_REQUEST: PermissionRequestData = {
	...OTHER_MAP_REQUEST,
	requestId: "r7",
	callId: "c7",
	toolName: "mcp__dms__builder_configure_project",
	args: { steps: CONFIGURE_STEPS },
	summary: "Configure project",
	preview: {
		type: "held",
		operation: "builder_configure_project",
		details: {
			plannedChanges: [
				{ path: "antelope.config.ts", kind: "modify", diff: CONFIGURE_DIFF },
			],
			steps: CONFIGURE_STEPS,
		},
	},
};

function mountCard(
	request: PermissionRequestData,
	messages: Record<string, unknown>,
) {
	return mount(PermissionCard, {
		props: { request, isFocused: true },
		global: {
			provide: { [CHAT_I18N_KEY as symbol]: createTestI18n(messages) },
			stubs: PANEL_STUBS,
		},
	});
}

describe("the card of another call to a tool the DMS holds", () => {
	it.each([
		[
			"en-GB",
			en,
			"Asked because another call to this tool is waiting for your confirmation.",
		],
		[
			"fr-FR",
			fr,
			"Demandé car un autre appel à cet outil attend votre accord.",
		],
	])(
		"says, in %s, that it asks because another call to the tool waits, and shows the call's own arguments (fails a card that claims the DMS holds this call)",
		(_locale, messages, why) => {
			const card = mountCard(OTHER_MAP_REQUEST, messages);
			expect(card.find(".perm__why").text()).toBe(why);
			const rows = card.find(".perm__kv");
			expect(rows.classes()).not.toContain("is-full");
			expect(rows.findAll("dt").map((cell) => cell.text())).toEqual([
				"module",
				"connection",
				"resources",
			]);
		},
	);
});

describe("the card of a configuration change the DMS holds", () => {
	it("lays the diff, and a row whose name is too long to sit beside its value, on the card's whole width under its name (fails a card that squeezes the DMS's diff into the column a long name leaves)", () => {
		const rows = mountCard(CONFIGURE_REQUEST, en).find(".perm__kv.is-full");
		const wide = (cell: string) =>
			rows.findAll(`${cell}.is-stacked`).map((node) => node.text());
		expect(wide("dt")).toEqual([
			"plannedChanges[0].path",
			"plannedChanges[0].kind",
			"plannedChanges[0].diff",
			"steps[0].config.externalConnections.erp.access",
		]);
		expect(wide("dd")).toEqual([
			"antelope.config.ts",
			"modify",
			CONFIGURE_DIFF.trim(),
			"read",
		]);
		expect(
			rows.findAll("dt:not(.is-stacked)").map((node) => node.text()),
		).toEqual(["steps[0].action", "steps[0].module"]);
	});

	it("titles the change by its verb alone, with no bare count of its steps (fails a title that appends the number of steps)", () => {
		const card = mountCard(CONFIGURE_REQUEST, en);
		expect(card.find(".perm__title").text()).toBe("Configure project");
	});
});
