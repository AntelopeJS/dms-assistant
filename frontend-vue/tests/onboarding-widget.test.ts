/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ONBOARDING_SELECTED_STATE_KEY } from "../app/onboarding/install";
import { dmsStateOf } from "./support/dms-frontend-module";
import {
	type Backend,
	CONVERSATION,
	resetBrowser,
	silenceStartup,
	startWithBackend,
	UNFINISHED,
	widget,
} from "./support/onboarding-host";

function chipClicked(): void {
	const clicks = dmsStateOf(ONBOARDING_SELECTED_STATE_KEY);
	if (clicks === undefined) throw new Error("the chip was never registered");
	clicks.value += 1;
}

beforeEach(silenceStartup);
afterEach(resetBrowser);

describe("the assistant's chip in the widget dock", () => {
	it("registers the chip with the key its clicks are counted under", async () => {
		const { stop } = startWithBackend({
			stateAnswers: [UNFINISHED],
			conversations: [],
		});
		await vi.waitFor(() => expect(widget()).toBeDefined());
		expect(widget()?.onSelectEvent).toBe(ONBOARDING_SELECTED_STATE_KEY);
		stop();
	});

	it("shows the dot while the onboarding needs attention and clears it once it does not", async () => {
		const backend: Backend = {
			stateAnswers: [UNFINISHED, UNFINISHED],
			conversations: [],
		};
		const { stop } = startWithBackend(backend);
		await vi.waitFor(() => expect(widget()?.badge).toBe("dot"));

		backend.conversations = [CONVERSATION];
		chipClicked();
		await vi.waitFor(() => expect(widget()).toBeDefined());
		await vi.waitFor(() => expect(widget()).not.toHaveProperty("badge"));
		stop();
	});

	it("opens the popup on a click of the chip and not on its initial count", async () => {
		const { provided, stop } = startWithBackend({
			stateAnswers: [UNFINISHED, UNFINISHED],
			conversations: [],
		});
		await vi.waitFor(() => expect(widget()).toBeDefined());
		expect(provided.value?.isOpen.value).toBe(false);

		chipClicked();
		await vi.waitFor(() => expect(provided.value?.isOpen.value).toBe(true));
		stop();
	});

	it("takes the chip off the dock when onboarding stops", async () => {
		const { stop } = startWithBackend({
			stateAnswers: [UNFINISHED],
			conversations: [],
		});
		await vi.waitFor(() => expect(widget()).toBeDefined());
		stop();
		expect(widget()).toBeUndefined();
	});
});

describe("the chip of a backend that does not answer the first read", () => {
	it("registers anyway, and a click of it opens the popup once the backend answers", async () => {
		const { provided, stop } = startWithBackend({
			stateAnswers: [
				async () => {
					throw new Error("503");
				},
				UNFINISHED,
			],
			conversations: [],
		});
		await vi.waitFor(() => expect(widget()).toBeDefined());
		expect(widget()).not.toHaveProperty("badge");

		chipClicked();
		await vi.waitFor(() => expect(provided.value?.isOpen.value).toBe(true));
		stop();
	});
});
