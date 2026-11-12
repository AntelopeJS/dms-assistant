// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeTokenCheck } from "../app/onboarding/contract";
import OnboardingClaude from "../app/views/onboarding/OnboardingClaude.vue";
import {
	CLAUDE_LOGIN,
	createOnboardingHarness,
	ONBOARDING_STUBS,
	type OnboardingHarness,
	onboardingState,
} from "./support/onboarding";

const CHECK_DELAY_MS = 400;

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

let harness: OnboardingHarness;
let wrapper: VueWrapper;

async function openOnTheTokenStep(): Promise<void> {
	await harness.controller.load();
	harness.controller.send({ type: "get-started" });
	harness.controller.send({ type: "sign-in", provider: "claude" });
	wrapper = mount(OnboardingClaude, {
		global: { provide: harness.provide, stubs: ONBOARDING_STUBS },
	});
}

function hint(): string {
	return wrapper.find("[data-token-hint]").text();
}

function continueButton(): HTMLButtonElement {
	return wrapper.find<HTMLButtonElement>("[data-continue]").element;
}

async function paste(token: string): Promise<void> {
	await wrapper.find("[data-token]").setValue(token);
}

beforeEach(() => {
	vi.useFakeTimers();
	harness = createOnboardingHarness();
});

afterEach(() => {
	wrapper.unmount();
	harness.controller.stop();
	vi.useRealTimers();
});

describe("the Claude token step", () => {
	it("checks a pasted token with Anthropic, and offers Continue once it works", async () => {
		await openOnTheTokenStep();
		const answer = deferred<ClaudeTokenCheck>();
		harness.api.checkClaudeToken.mockReturnValueOnce(answer.promise);

		await paste("sk-ant-oat01-good");
		expect(hint()).toBe("Checking with Anthropic…");
		expect(continueButton().disabled).toBe(true);

		await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
		expect(harness.api.checkClaudeToken).toHaveBeenCalledWith(
			"sk-ant-oat01-good",
		);
		answer.resolve({ ok: true, email: "owner@example.com", plan: "max" });
		await flushPromises();
		expect(hint()).toBe("Connected · Claude Max · owner@example.com");
		expect(continueButton().disabled).toBe(false);
	});

	it("says a rejected token was rejected, and keeps Continue off", async () => {
		await openOnTheTokenStep();
		harness.api.checkClaudeToken.mockResolvedValueOnce({
			ok: false,
			reason: "rejected",
		});

		await paste("sk-ant-oat01-revoked");
		await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
		await flushPromises();
		expect(hint()).toBe(
			"This token was rejected. Run the command again and paste the new token.",
		);
		expect(continueButton().disabled).toBe(true);
	});

	it("drops the answer about a token the user has since replaced", async () => {
		await openOnTheTokenStep();
		const stale = deferred<ClaudeTokenCheck>();
		harness.api.checkClaudeToken
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce({ ok: true, plan: "pro" });

		await paste("sk-ant-oat01-first");
		await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
		await paste("sk-ant-oat01-second");
		await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
		await flushPromises();
		stale.resolve({ ok: false, reason: "rejected" });
		await flushPromises();
		expect(hint()).toBe("Connected · Claude Pro");
		expect(continueButton().disabled).toBe(false);
	});

	it("moves on to the connected view once the backend reads the saved token as working", async () => {
		await openOnTheTokenStep();
		harness.api.checkClaudeToken.mockResolvedValueOnce({ ok: true });
		harness.api.readState.mockResolvedValue(
			onboardingState({ claude: CLAUDE_LOGIN }),
		);

		await paste("sk-ant-oat01-good");
		await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
		await flushPromises();
		await wrapper.find("[data-continue]").trigger("click");
		await flushPromises();
		expect(harness.controller.flow.value.view).toEqual({
			kind: "connected",
			provider: "claude",
		});
	});
});
