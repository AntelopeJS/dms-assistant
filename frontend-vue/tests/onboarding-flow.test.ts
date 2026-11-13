import { describe, expect, it } from "vitest";
import type {
	OnboardingState,
	ProviderLogin,
} from "../app/onboarding/contract";
import {
	firstFlow,
	type FirstViewInput,
	opensOnItsOwn,
	type OpeningInput,
	transition,
} from "../app/onboarding/flow";

const SIGNED_OUT: ProviderLogin = { status: "signed-out" };
const CLAUDE_CLI: ProviderLogin = {
	status: "signed-in",
	source: "claude-cli",
	email: "owner@example.com",
	plan: "max",
};

function state(
	logins: Partial<OnboardingState["logins"]> = {},
	provider: OnboardingState["provider"] = "claude",
): OnboardingState {
	return {
		bootId: "boot-1",
		provider,
		logins: { claude: SIGNED_OUT, codex: SIGNED_OUT, ...logins },
	};
}

function input(overrides: Partial<FirstViewInput> = {}): FirstViewInput {
	return {
		state: state(),
		hasContent: false,
		canConnectDatabase: true,
		step: null,
		...overrides,
	};
}

describe("the view the popup opens on", () => {
	it("is the welcome when no AI login works", () => {
		expect(firstFlow(input()).view).toEqual({ kind: "welcome" });
	});

	it("skips the welcome for a login found on the machine", () => {
		const flow = firstFlow(input({ state: state({ claude: CLAUDE_CLI }) }));
		expect(flow.view).toEqual({ kind: "ready", provider: "claude" });
	});

	it("offers the other provider's login when the assistant's own is signed out", () => {
		const flow = firstFlow(input({ state: state({ codex: CLAUDE_CLI }) }));
		expect(flow.view).toEqual({ kind: "ready", provider: "codex" });
	});

	it("is the AI step for an expired login, the assistant's provider chosen", () => {
		const expired: ProviderLogin = { status: "expired", source: "saved" };
		const flow = firstFlow(input({ state: state({ claude: expired }) }));
		expect(flow.view).toEqual({ kind: "ai", choice: "claude" });
	});

	it("is Continue once a login works and the project has content", () => {
		const flow = firstFlow(
			input({ state: state({ claude: CLAUDE_CLI }), hasContent: true }),
		);
		expect(flow.view).toEqual({ kind: "continue" });
		expect(flow.start).toBe("continue");
	});

	it("is the connect form for ?assistant=connect when a login works", () => {
		const flow = firstFlow(
			input({
				state: state({ claude: CLAUDE_CLI }),
				hasContent: true,
				step: "connect-database",
			}),
		);
		expect(flow.view).toEqual({ kind: "connect-database" });
	});

	it("goes through the AI step for ?assistant=connect without a login, then on to the connect form", () => {
		const flow = firstFlow(input({ step: "connect-database" }));
		expect(flow.view).toEqual({ kind: "ai", choice: "claude" });
		const token = transition(flow, { type: "sign-in", provider: "claude" });
		expect(token.view).toEqual({ kind: "claude" });
		const connected = transition(token, {
			type: "signed-in",
			provider: "claude",
		});
		expect(connected.view).toEqual({ kind: "connect-database" });
	});

	it("ignores ?assistant=connect without the builder, as there is no form to open", () => {
		const flow = firstFlow(
			input({
				state: state({ claude: CLAUDE_CLI }),
				canConnectDatabase: false,
				step: "connect-database",
			}),
		);
		expect(flow.view).toEqual({ kind: "ready", provider: "claude" });
	});
});

describe("moving through the popup", () => {
	it("confirms a new login, then leads to the starting point", () => {
		const welcome = firstFlow(input());
		const ai = transition(welcome, { type: "get-started" });
		const codex = transition(
			transition(ai, { type: "choose", provider: "codex" }),
			{ type: "sign-in", provider: "codex" },
		);
		expect(codex.view).toEqual({ kind: "codex", mode: "idle" });
		const connected = transition(codex, {
			type: "signed-in",
			provider: "codex",
		});
		expect(connected.view).toEqual({ kind: "connected", provider: "codex" });
		expect(transition(connected, { type: "next" }).view).toEqual({
			kind: "paths",
		});
	});

	it("goes back to the view it came from, and to the starting point once a login worked", () => {
		const ready = firstFlow(
			input({ state: state({ claude: CLAUDE_CLI }), hasContent: true }),
		);
		const scratch = transition(ready, { type: "pick", path: "scratch" });
		expect(transition(scratch, { type: "back" }).view).toEqual({
			kind: "continue",
		});
		const ai = transition(firstFlow(input()), { type: "get-started" });
		expect(transition(ai, { type: "back" }).view).toEqual({ kind: "welcome" });
		const signedIn = transition(
			transition(ai, { type: "sign-in", provider: "claude" }),
			{ type: "signed-in", provider: "claude" },
		);
		expect(signedIn.history).toEqual([]);
	});

	it("keeps an analysis off the Back path, so the written connection is not submitted again", () => {
		const form = transition(
			firstFlow(input({ state: state({ claude: CLAUDE_CLI }) })),
			{
				type: "pick",
				path: "connect-database",
			},
		);
		const analysis = transition(form, {
			type: "analysed",
			connection: "shop",
			module: "builder-db-shop-tables",
		});
		expect(transition(analysis, { type: "back" }).view).toEqual({
			kind: "ready",
			provider: "claude",
		});
	});
});

describe("whether the popup opens on its own", () => {
	function opening(overrides: Partial<OpeningInput> = {}): OpeningInput {
		return {
			done: true,
			dontShow: false,
			bootId: "boot-2",
			seenBootId: "boot-1",
			step: null,
			...overrides,
		};
	}

	it("reopens once per server start after onboarding", () => {
		expect(opensOnItsOwn(opening())).toBe(true);
		expect(opensOnItsOwn(opening({ seenBootId: "boot-2" }))).toBe(false);
	});

	it("stays closed once Don't show on startup is ticked, on this start as on a new one", () => {
		expect(
			opensOnItsOwn(opening({ dontShow: true, seenBootId: "boot-2" })),
		).toBe(false);
		expect(opensOnItsOwn(opening({ dontShow: true }))).toBe(false);
	});

	it("opens on every load until onboarding is done", () => {
		expect(opensOnItsOwn(opening({ done: false, seenBootId: "boot-2" }))).toBe(
			true,
		);
	});

	it("opens for a step a link asked for, whatever the preference", () => {
		expect(
			opensOnItsOwn(
				opening({
					dontShow: true,
					seenBootId: "boot-2",
					step: "connect-database",
				}),
			),
		).toBe(true);
	});
});
