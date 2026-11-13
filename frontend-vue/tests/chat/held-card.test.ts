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
