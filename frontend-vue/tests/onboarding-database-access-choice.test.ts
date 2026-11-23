/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingDatabase from "../app/views/onboarding/OnboardingDatabase.vue";
import OnboardingFrame from "../app/views/onboarding/OnboardingFrame.vue";
import views from "../i18n/locales/dms-assistant-views-en-GB.json";
import { builderServer } from "./support/builder-server";
import { PROJECT, URL, WRITER } from "./support/database-connect";
import {
	createOnboardingHarness,
	ONBOARDING_STUBS,
} from "./support/onboarding";

const builder = builderServer();

let wrapper: VueWrapper | undefined;

beforeEach(builder.serve);

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	builder.reset();
	vi.restoreAllMocks();
});

function connectButton(popup: VueWrapper): HTMLButtonElement {
	const label = views.dms_assistant.views.onboarding.database.connect;
	const found = popup
		.findAll<HTMLButtonElement>("button")
		.find((candidate) => candidate.text() === label);
	if (found === undefined) throw new Error(`no button reads ${label}`);
	return found.element;
}

describe("the access choice of an account that can write", () => {
	it("scrolls the choice into view when it appears (fails on a popup that shows the read or write choice out of view, where the footer covers it and a click on Read and write misses it)", async () => {
		builder.project.mockResolvedValue(PROJECT);
		builder.check.mockResolvedValue(WRITER);
		const scrolled: Element[] = [];
		Element.prototype.scrollIntoView = function (this: Element) {
			scrolled.push(this);
		};
		const harness = createOnboardingHarness();
		wrapper = mount(OnboardingDatabase, {
			global: { provide: harness.provide, stubs: ONBOARDING_STUBS },
		});
		await flushPromises();
		await wrapper.find("input").setValue(URL);
		connectButton(wrapper).click();
		await flushPromises();

		const choice = wrapper.find("[data-access-choice]");
		expect(choice.exists()).toBe(true);
		expect(scrolled).toEqual([choice.element]);
	});
});

describe("the popup's frame", () => {
	it("scrolls its content and keeps the footer out of the scroll (fails on a frame whose content cannot scroll, so a view taller than the window hides what is under the footer)", () => {
		wrapper = mount(OnboardingFrame, {
			slots: { default: "<p>content</p>", footer: "<button>next</button>" },
			global: {
				provide: createOnboardingHarness().provide,
				stubs: ONBOARDING_STUBS,
			},
		});
		const body = wrapper.find("[data-onboarding-body]");
		expect(body.classes()).toEqual(
			expect.arrayContaining(["overflow-y-auto", "shrink"]),
		);
		expect(wrapper.find("button").element.parentElement?.classList).toContain(
			"shrink-0",
		);
	});
});
