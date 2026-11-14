import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CLAUDE_LOGIN,
	createOnboardingHarness,
	memoryConnects,
	memoryPreferences,
	type OnboardingHarness,
	onboardingState,
} from "./support/onboarding";

const CONVERSATION = {
	conversations: [{ id: "c1", title: "Orders dashboard", updatedAtMs: 1 }],
	mockups: [],
	databases: [],
};

const FOLLOWED = {
	engine: "mongodb" as const,
	connection: "shop",
	access: { reachable: true, canRead: true, canWrite: false },
};

const harnesses: OnboardingHarness[] = [];

/** A page loaded while the backend restarts: its first read of the onboarding fails. */
function loadedDuringRestart(
	followed: typeof FOLLOWED | null,
): OnboardingHarness {
	const harness = createOnboardingHarness({
		state: onboardingState({ claude: CLAUDE_LOGIN }),
		content: CONVERSATION,
		preferences: memoryPreferences({ dontShow: true, seenBootId: "boot-1" }),
		connecting: memoryConnects(followed),
	});
	harnesses.push(harness);
	harness.api.readState.mockRejectedValueOnce(new Error("502"));
	return harness;
}

afterEach(() => {
	harnesses.splice(0).forEach((harness) => harness.controller.stop());
	vi.useRealTimers();
});

describe("a page loaded while the backend restarts", () => {
	it("opens on the connect form once the backend answers, while this tab follows a connection it wrote", async () => {
		vi.useFakeTimers();
		const { controller } = loadedDuringRestart(FOLLOWED);
		await controller.load().catch(() => undefined);
		expect(controller.isOpen.value).toBe(false);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(controller.isOpen.value).toBe(true);
		expect(controller.flow.value.view).toEqual({ kind: "connect-database" });
	});

	it("reads no more on its own when this tab follows no connection", async () => {
		vi.useFakeTimers();
		const { controller, api } = loadedDuringRestart(null);
		await controller.load().catch(() => undefined);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(api.readState).toHaveBeenCalledTimes(1);
		expect(controller.isOpen.value).toBe(false);
	});

	it("reads no more once the onboarding stopped", async () => {
		vi.useFakeTimers();
		const { controller, api } = loadedDuringRestart(FOLLOWED);
		await controller.load().catch(() => undefined);
		controller.stop();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(api.readState).toHaveBeenCalledTimes(1);
	});
});
