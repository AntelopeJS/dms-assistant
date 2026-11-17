// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import OnboardingAnalysis from "../app/views/onboarding/OnboardingAnalysis.vue";
import { CHAT_I18N_KEY } from "../app/chat/composables/useChatI18n";
import { createTestI18n } from "./support/i18n";
import { ONBOARDING_STUBS } from "./support/onboarding";
import views from "../i18n/locales/dms-assistant-views-en-GB.json";

const proposed = <T>(value: T) => ({ value, rule: "test", kind: "inferred" });

const proposal = {
	connection: "shop",
	module: "m",
	database: { engine: "postgresql", role: "reader", writes: "none" },
	resources: ["public.customers", "public.orders"].map((relation, index) => ({
		relation,
		rows: 1680 * (index + 1),
		tableView: proposed(true),
		writable: proposed(false),
		label: proposed(null),
		title: proposed(relation),
		fields: [],
		leftOut: [],
		writes: { insert: false, update: false, delete: false },
	})),
	excluded: [],
	open: [],
};

vi.mock("../builder/app/runtime/api", () => ({
	useBuilderApi: () => ({
		latestAnalysis: async () => ({ ok: true, data: { proposal } }),
		failure: () => ({ detail: "" }),
		mapDatabase: async () => ({ ok: true, data: { resources: [] } }),
	}),
}));

vi.mock("../app/onboarding/runtime", () => ({
	useOnboarding: () => ({
		problem: ref(null),
		send: () => undefined,
		close: () => undefined,
		navigate: () => undefined,
		startConversation: () => undefined,
	}),
}));

describe("the analysis's scrolling lists", () => {
	it("keep room at their end for a scrollbar, so it never covers a row count or a screen's kind (fails when a list scrolls with no gutter or padding)", async () => {
		const wrapper = mount(OnboardingAnalysis, {
			props: {
				view: { kind: "analysis", connection: "shop", module: "m" },
			},
			global: {
				stubs: ONBOARDING_STUBS,
				provide: { [CHAT_I18N_KEY as symbol]: createTestI18n(views) },
			},
		});
		await flushPromises();

		const lists = wrapper.findAll("ul");
		expect(lists).toHaveLength(2);
		for (const list of lists) {
			expect(list.classes()).toContain("overflow-y-auto");
			expect(list.classes()).toContain("[scrollbar-gutter:stable]");
			expect(list.classes()).toContain("pe-4");
		}
	});
});
