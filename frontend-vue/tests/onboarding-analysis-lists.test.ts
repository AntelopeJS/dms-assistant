/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import OnboardingAnalysis from "../app/views/onboarding/OnboardingAnalysis.vue";
import { builderServer } from "./support/builder-server";
import {
	analysisWith,
	answered,
	proposedRelation,
} from "./support/database-connect";
import {
	createOnboardingHarness,
	ONBOARDING_STUBS,
} from "./support/onboarding";

const resources = ["public.customers", "public.orders"].map(
	(relation, index) => ({
		...proposedRelation(relation),
		rows: 1680 * (index + 1),
	}),
);

const builder = builderServer();

beforeEach(() => {
	builder.serve();
	builder.analysis.mockResolvedValue(answered(analysisWith([], [], resources)));
});

afterEach(builder.reset);

describe("the analysis's scrolling lists", () => {
	it("keep room at their end for a scrollbar, so it never covers a row count or a screen's kind (fails when a list scrolls with no gutter or padding)", async () => {
		const wrapper = mount(OnboardingAnalysis, {
			props: {
				view: { kind: "analysis", connection: "shop", module: "m" },
			},
			global: {
				stubs: ONBOARDING_STUBS,
				provide: createOnboardingHarness().provide,
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
