import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type { ProviderLogin } from "../app/onboarding/contract";
import { CODEX_POLL_MS } from "../app/onboarding/controller";
import type { OnboardingController } from "../app/onboarding/controller";
import { publicOnboarding } from "../app/onboarding/runtime";
import {
	CLAUDE_LOGIN,
	createOnboardingHarness,
	memoryPreferences,
	type OnboardingHarness,
	onboardingState,
} from "./support/onboarding";

const CONVERSATION = {
	conversations: [{ id: "c1", title: "Orders dashboard", updatedAtMs: 1 }],
	mockups: [],
	databases: [],
};

const harnesses: OnboardingHarness[] = [];

function harnessed(
	options: Parameters<typeof createOnboardingHarness>[0],
): OnboardingHarness {
	const harness = createOnboardingHarness(options);
	harnesses.push(harness);
	return harness;
}

afterEach(() => {
	harnesses.splice(0).forEach((harness) => harness.controller.stop());
	vi.useRealTimers();
});

describe("the onboarding another module opens", () => {
	it("is not available before the backend answered, then opens the popup on the step asked for", async () => {
		const { controller } = harnessed({
			state: onboardingState({ claude: CLAUDE_LOGIN }),
			content: CONVERSATION,
			preferences: memoryPreferences({ dontShow: true, seenBootId: "boot-1" }),
		});
		const onboarding = publicOnboarding(shallowRef(controller));
		expect(onboarding.isAvailable).toBe(false);

		onboarding.open("connect-database");
		await controller.load();
		expect(onboarding.isAvailable).toBe(true);
		expect(controller.isOpen.value).toBe(true);
		expect(controller.flow.value.view).toEqual({ kind: "connect-database" });

		controller.close();
		onboarding.open();
		expect(controller.isOpen.value).toBe(true);
		expect(controller.flow.value.view).toEqual({ kind: "continue" });
	});

	it("answers unavailable and opens nothing where the assistant does not run", () => {
		const onboarding = publicOnboarding(
			shallowRef<OnboardingController | null>(null),
		);
		expect(onboarding.isAvailable).toBe(false);
		expect(() => onboarding.open("connect-database")).not.toThrow();
	});
});

describe("opening on its own", () => {
	it("opens once per server start on a finished project, remembered in this browser", async () => {
		const preferences = memoryPreferences();
		const options = {
			state: onboardingState({ claude: CLAUDE_LOGIN }),
			content: CONVERSATION,
			preferences,
		};
		const first = harnessed(options).controller;
		await first.load();
		expect(first.isOpen.value).toBe(true);

		const reload = harnessed(options).controller;
		await reload.load();
		expect(reload.isOpen.value).toBe(false);

		const restarted = harnessed({
			...options,
			state: onboardingState({ claude: CLAUDE_LOGIN }, { bootId: "boot-2" }),
		}).controller;
		await restarted.load();
		expect(restarted.isOpen.value).toBe(true);
	});
});

describe("signing in with ChatGPT", () => {
	it("asks every two seconds whether the sign-in completed, then runs the assistant on Codex", async () => {
		vi.useFakeTimers();
		const signedOut = onboardingState(
			{},
			{ codexLoginUrl: "https://auth.openai.com/authorize?state=1" },
		);
		const harness = harnessed({ state: signedOut });
		const { controller, api } = harness;
		await controller.load();
		controller.send({ type: "get-started" });
		controller.send({ type: "sign-in", provider: "codex" });
		controller.signInWithChatGpt();
		expect(harness.openTab).toHaveBeenCalledWith(
			"https://auth.openai.com/authorize?state=1",
		);
		api.readState.mockClear();

		await vi.advanceTimersByTimeAsync(CODEX_POLL_MS);
		expect(api.readState).toHaveBeenCalledTimes(1);
		expect(controller.flow.value.view).toEqual({
			kind: "codex",
			mode: "waiting",
		});

		const codex: ProviderLogin = {
			status: "signed-in",
			source: "chatgpt",
			email: "owner@example.com",
		};
		api.readState.mockResolvedValue(onboardingState({ codex }));
		await vi.advanceTimersByTimeAsync(CODEX_POLL_MS);
		expect(api.setProvider).toHaveBeenCalledWith("codex");
		expect(controller.flow.value.view).toEqual({
			kind: "connected",
			provider: "codex",
		});

		await vi.advanceTimersByTimeAsync(CODEX_POLL_MS * 3);
		expect(api.readState).toHaveBeenCalledTimes(2);
	});
});
