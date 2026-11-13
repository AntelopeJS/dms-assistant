// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resetBrowser,
	silenceStartup,
	startWithBackend,
	UNFINISHED,
	widget,
} from "./support/onboarding-host";

vi.mock("#dms/frontend-module", async () => {
	const { dmsModule } = await import("./support/dms-state");
	return dmsModule;
});

beforeEach(silenceStartup);
afterEach(resetBrowser);

describe("a backend that does not answer the first read", () => {
	it("still registers the chip, and a click of it opens the popup once the backend answers", async () => {
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
		expect(provided.value?.isAvailable.value).toBe(false);
		expect(widget()).not.toHaveProperty("badge");

		provided.value?.open();
		await vi.waitFor(() => expect(provided.value?.isOpen.value).toBe(true));
		expect(provided.value?.isAvailable.value).toBe(true);
		stop();
	});

	it("keeps the step a deep link asked for until the popup can open", async () => {
		window.history.pushState({}, "", "/?assistant=connect");
		const { provided, stop } = startWithBackend(
			{
				stateAnswers: [
					async () => {
						throw new Error("503");
					},
					UNFINISHED,
				],
				conversations: [],
			},
			{ assistant: "connect" },
		);
		await vi.waitFor(() => expect(widget()).toBeDefined());
		provided.value?.open();
		await vi.waitFor(() => expect(provided.value?.isOpen.value).toBe(true));
		expect(provided.value?.flow.value.view).toEqual({
			kind: "connect-database",
		});
		stop();
	});
});
