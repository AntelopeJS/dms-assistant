import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type { ProviderLogin } from "../app/onboarding/contract";
import { CODEX_POLL_MS } from "../app/onboarding/controller";
import type { OnboardingController } from "../app/onboarding/controller";
import { publicOnboarding } from "../app/onboarding/runtime";
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

	it("opens on the connect form after a reload while this tab follows a connection it wrote", async () => {
		const { controller } = harnessed({
			state: onboardingState({ claude: CLAUDE_LOGIN }),
			content: CONVERSATION,
			preferences: memoryPreferences({ dontShow: true, seenBootId: "boot-1" }),
			connecting: memoryConnects({
				engine: "mongodb",
				connection: "shop",
				module: "builder-db-shop-tables",
				access: { reachable: true, canRead: true, canWrite: false },
			}),
		});
		await controller.load();
		expect(controller.isOpen.value).toBe(true);
		expect(controller.flow.value.view).toEqual({ kind: "connect-database" });
	});

	it("reopens on the connect form while this tab follows a connection it wrote, and on its start once it does not", async () => {
		const connecting = memoryConnects();
		const { controller } = harnessed({
			state: onboardingState({ claude: CLAUDE_LOGIN }),
			content: CONVERSATION,
			connecting,
		});
		await controller.load();
		controller.open("connect-database");
		connecting.write(connecting.begin(), {
			engine: "mongodb",
			connection: "shop",
			module: "builder-db-shop-tables",
			access: { reachable: true, canRead: true, canWrite: false },
		});
		controller.close();

		controller.open();
		expect(controller.flow.value.view).toEqual({ kind: "connect-database" });

		connecting.clear();
		controller.close();
		controller.open();
		expect(controller.flow.value.view).toEqual({ kind: "continue" });
	});

	it("stays closed on a remembered connection where the builder does not run", async () => {
		const { controller } = harnessed({
			state: onboardingState({ claude: CLAUDE_LOGIN }),
			content: CONVERSATION,
			preferences: memoryPreferences({ dontShow: true, seenBootId: "boot-1" }),
			canConnectDatabase: false,
			connecting: memoryConnects({
				engine: "mongodb",
				connection: "shop",
				module: "builder-db-shop-tables",
				access: { reachable: true, canRead: true, canWrite: false },
			}),
		});
		await controller.load();
		expect(controller.isOpen.value).toBe(false);
	});
});

describe("the project's content as this session left it", () => {
	it("opens on Continue, and drops the widget's dot, once a conversation exists that the load did not see", async () => {
		const harness = harnessed({
			state: onboardingState({ claude: CLAUDE_LOGIN }),
		});
		const { controller } = harness;
		await controller.load();
		expect(controller.flow.value.view.kind).toBe("ready");
		expect(controller.needsAttention.value).toBe(true);

		harness.setContent(CONVERSATION);
		controller.close();
		controller.open();
		await vi.waitFor(() =>
			expect(controller.flow.value.view.kind).toBe("continue"),
		);
		expect(controller.needsAttention.value).toBe(false);
	});

	it("keeps the view the user already moved on from while the content is read again", async () => {
		const harness = harnessed({
			state: onboardingState({ claude: CLAUDE_LOGIN }),
		});
		const { controller } = harness;
		await controller.load();
		harness.setContent(CONVERSATION);
		controller.close();
		controller.open();
		controller.send({ type: "back" });
		const moved = controller.flow.value;
		await vi.waitFor(() => expect(controller.needsAttention.value).toBe(false));
		expect(controller.flow.value).toBe(moved);
	});
});

describe("a backend that did not answer the first read", () => {
	it("opens on a later open once the backend answers, on the step an earlier open asked for", async () => {
		const harness = harnessed({
			state: onboardingState({ claude: CLAUDE_LOGIN }),
			content: CONVERSATION,
		});
		const { controller, api } = harness;
		const answer = await api.readState();
		api.readState.mockRejectedValueOnce(new Error("503"));
		controller.open("connect-database");
		await controller.load().catch(() => undefined);
		expect(controller.isAvailable.value).toBe(false);
		expect(controller.isOpen.value).toBe(false);

		api.readState.mockResolvedValue(answer);
		controller.open();
		await vi.waitFor(() => expect(controller.isOpen.value).toBe(true));
		expect(controller.isAvailable.value).toBe(true);
		expect(controller.flow.value.view).toEqual({ kind: "connect-database" });
	});

	it("does not read before the first load has been tried", () => {
		const { controller, api } = harnessed({});
		controller.open();
		expect(api.readState).not.toHaveBeenCalled();
	});
});

async function waitingForChatGpt(): Promise<OnboardingHarness> {
	const harness = harnessed({
		state: onboardingState(
			{},
			{ codexLoginUrl: "https://auth.openai.com/authorize?state=1" },
		),
	});
	await harness.controller.load();
	harness.controller.send({ type: "get-started" });
	harness.controller.send({ type: "sign-in", provider: "codex" });
	harness.controller.signInWithChatGpt();
	return harness;
}

function lateAnswer(api: OnboardingHarness["api"]): { signedIn: () => void } {
	let answer: (state: ReturnType<typeof onboardingState>) => void = () =>
		undefined;
	api.readState.mockImplementation(
		() => new Promise((resolve) => (answer = resolve)),
	);
	return {
		signedIn: () =>
			answer(
				onboardingState({ codex: { status: "signed-in", source: "chatgpt" } }),
			),
	};
}

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

	it("drops a poll answer that arrives after the user went back from the waiting view", async () => {
		vi.useFakeTimers();
		const { controller, api } = await waitingForChatGpt();
		const late = lateAnswer(api);
		await vi.advanceTimersByTimeAsync(CODEX_POLL_MS);
		controller.send({ type: "back" });
		controller.send({ type: "sign-in", provider: "claude" });
		late.signedIn();
		await vi.advanceTimersByTimeAsync(10);
		expect(controller.flow.value.view.kind).toBe("claude");
		expect(api.setProvider).not.toHaveBeenCalled();
	});

	it("drops a poll answer that arrives after the popup was closed", async () => {
		vi.useFakeTimers();
		const { controller, api } = await waitingForChatGpt();
		const late = lateAnswer(api);
		await vi.advanceTimersByTimeAsync(CODEX_POLL_MS);
		controller.close();
		late.signedIn();
		await vi.advanceTimersByTimeAsync(10);
		expect(api.setProvider).not.toHaveBeenCalled();
		expect(controller.state.value?.logins.codex.status).toBe("signed-out");
	});
});
