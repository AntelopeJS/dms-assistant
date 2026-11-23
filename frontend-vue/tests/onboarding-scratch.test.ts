/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import Onboarding from "../app/components/Onboarding.vue";
import {
	CLAUDE_LOGIN,
	createOnboardingHarness,
	ONBOARDING_STUBS,
	type OnboardingHarness,
	onboardingState,
} from "./support/onboarding";

let harness: OnboardingHarness;

afterEach(() => {
	harness.controller.stop();
});

async function popupOnScratch() {
	harness = createOnboardingHarness({
		state: onboardingState({ claude: CLAUDE_LOGIN }),
	});
	const wrapper = mount(Onboarding, {
		global: { provide: harness.provide, stubs: ONBOARDING_STUBS },
	});
	await harness.controller.load();
	await flushPromises();
	expect(wrapper.text()).toContain("Your assistant is ready");
	harness.controller.send({ type: "use-login" });
	harness.controller.send({ type: "pick", path: "scratch" });
	await flushPromises();
	return wrapper;
}

describe("starting from scratch", () => {
	it("closes the popup and sends the description as a new conversation's first message", async () => {
		const wrapper = await popupOnScratch();
		await wrapper
			.find("textarea")
			.setValue("A back office for my bike rental shop");
		await wrapper.find("[data-start]").trigger("click");

		expect(harness.assistant.startConversation).toHaveBeenCalledTimes(1);
		const [prompt, mode, send] =
			harness.assistant.startConversation.mock.calls[0] ?? [];
		expect(prompt).toContain("A back office for my bike rental shop");
		expect(mode).toBeUndefined();
		expect(send).toBe(true);
		await flushPromises();
		expect(harness.controller.isOpen.value).toBe(false);
		expect(wrapper.find("[role=dialog]").exists()).toBe(false);
	});

	it("fills the description from a suggestion, and sends nothing while it is empty", async () => {
		const wrapper = await popupOnScratch();
		const start = wrapper.find<HTMLButtonElement>("[data-start]");
		expect(start.element.disabled).toBe(true);

		const suggestion = wrapper
			.findAll("button")
			.find((button) => button.text() === "Inventory & suppliers");
		await suggestion?.trigger("click");
		expect(wrapper.find("textarea").element.value).toBe(
			"Inventory & suppliers",
		);
		await start.trigger("click");
		const [prompt] = harness.assistant.startConversation.mock.calls[0] ?? [];
		expect(prompt).toContain("Inventory & suppliers");
	});
});
