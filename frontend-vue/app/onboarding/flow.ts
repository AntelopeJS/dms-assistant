import { type OnboardingState, PROVIDERS, type ProviderName } from "./contract";
import type { OnboardingStep } from "./public";

/** The ChatGPT sign-in: before it, waiting for the new tab, or pasting the address a remote browser could not load. */
export type CodexMode = "idle" | "waiting" | "remote";

/** What the popup shows. Each view holds only what it is about; the data it lists is read where it is drawn. */
export type OnboardingView =
	| { kind: "welcome" }
	| { kind: "ready"; provider: ProviderName }
	| { kind: "ai"; choice: ProviderName | null }
	| { kind: "claude" }
	| { kind: "codex"; mode: CodexMode }
	| { kind: "connected"; provider: ProviderName }
	| { kind: "paths" }
	| { kind: "continue" }
	| { kind: "scratch" }
	| { kind: "connect-database" }
	| { kind: "analysis"; connection: string; module: string };

export type ViewKind = OnboardingView["kind"];

/** The view that picks a starting point: Continue once the project has content, the two paths before. */
export type StartingPoint = Extract<ViewKind, "paths" | "continue">;

export interface OnboardingFlow {
	view: OnboardingView;
	/** The views Back returns to, latest last. */
	history: readonly OnboardingView[];
	/** Where a login that works leads: the starting point, or the connect form a link asked for. */
	then: "start" | "connect-database";
	start: StartingPoint;
}

export type FlowEvent =
	| { type: "get-started" }
	| { type: "choose-another" }
	| { type: "choose"; provider: ProviderName }
	| { type: "sign-in"; provider: ProviderName }
	| { type: "codex"; mode: CodexMode }
	| { type: "signed-in"; provider: ProviderName }
	| { type: "use-login" }
	| { type: "next" }
	| { type: "pick"; path: "scratch" | "connect-database" }
	| { type: "analysed"; connection: string; module: string }
	| { type: "back" };

/** Which of the three segments of the progress bar a view lights up to: welcome, AI, start. */
export const PROGRESS: Record<ViewKind, 0 | 1 | 2> = {
	welcome: 0,
	ready: 1,
	ai: 1,
	claude: 1,
	codex: 1,
	connected: 1,
	paths: 2,
	continue: 2,
	scratch: 2,
	"connect-database": 2,
	analysis: 2,
};

/** What decides the view the popup opens on. */
export interface FirstViewInput {
	state: OnboardingState;
	hasContent: boolean;
	/** The builder runs, so a database can be connected. */
	canConnectDatabase: boolean;
	/** The step a link or another module asked for. */
	step: OnboardingStep | null;
}

function isSignedIn(state: OnboardingState, provider: ProviderName): boolean {
	return state.logins[provider].status === "signed-in";
}

/** The login the assistant can run on: its provider's, else the other one that works. */
export function workingLogin(state: OnboardingState): ProviderName | null {
	if (isSignedIn(state, state.provider)) return state.provider;
	return PROVIDERS.find((provider) => isSignedIn(state, provider)) ?? null;
}

/** Onboarding is done once the assistant's login works and the project has content. */
export function isDone(state: OnboardingState, hasContent: boolean): boolean {
	return isSignedIn(state, state.provider) && hasContent;
}

/**
 * The flow the popup opens on. A working login skips the welcome; an expired one, or a link to the
 * connect form with no working login, opens on the AI step; once the project has content it opens
 * on Continue.
 */
export function firstFlow(input: FirstViewInput): OnboardingFlow {
	const { state } = input;
	const connect = input.step === "connect-database" && input.canConnectDatabase;
	const base = {
		history: [],
		then: connect ? ("connect-database" as const) : ("start" as const),
		start: input.hasContent ? ("continue" as const) : ("paths" as const),
	};
	const works = isSignedIn(state, state.provider);
	if (works && connect) return { ...base, view: { kind: "connect-database" } };
	if (works && input.hasContent) return { ...base, view: { kind: "continue" } };
	if (works)
		return { ...base, view: { kind: "ready", provider: state.provider } };
	const other = workingLogin(state);
	if (connect || state.logins[state.provider].status === "expired") {
		return { ...base, view: { kind: "ai", choice: other ?? state.provider } };
	}
	if (other) return { ...base, view: { kind: "ready", provider: other } };
	return { ...base, view: { kind: "welcome" } };
}

/** What the popup's preferences in this browser say. */
export interface OpeningInput {
	done: boolean;
	dontShow: boolean;
	bootId: string;
	/** The server start the popup last opened in, in this browser. */
	seenBootId: string | null;
	step: OnboardingStep | null;
}

/**
 * Whether the popup opens on its own: always for a step asked for, never once "Don't show on
 * startup" is ticked, else until onboarding is done and then once per server start.
 */
export function opensOnItsOwn(input: OpeningInput): boolean {
	if (input.step !== null) return true;
	if (input.dontShow) return false;
	return !input.done || input.seenBootId !== input.bootId;
}

function go(flow: OnboardingFlow, view: OnboardingView): OnboardingFlow {
	return { ...flow, view, history: [...flow.history, flow.view] };
}

/** A login works: what came before it is behind the user, so Back no longer leads there. */
function settle(flow: OnboardingFlow, view: OnboardingView): OnboardingFlow {
	return { ...flow, view, history: [] };
}

function afterLogin(flow: OnboardingFlow): OnboardingView {
	return flow.then === "connect-database"
		? { kind: "connect-database" }
		: { kind: flow.start };
}

function back(flow: OnboardingFlow): OnboardingFlow {
	const previous = flow.history.at(-1);
	if (previous === undefined) return { ...flow, view: { kind: flow.start } };
	return { ...flow, view: previous, history: flow.history.slice(0, -1) };
}

/** The flow after an event. An event the view does not offer leaves it as it is. */
export function transition(
	flow: OnboardingFlow,
	event: FlowEvent,
): OnboardingFlow {
	switch (event.type) {
		case "get-started":
		case "choose-another":
			return go(flow, { kind: "ai", choice: null });
		case "choose":
			return flow.view.kind === "ai"
				? { ...flow, view: { kind: "ai", choice: event.provider } }
				: flow;
		case "sign-in":
			return go(
				flow,
				event.provider === "claude"
					? { kind: "claude" }
					: { kind: "codex", mode: "idle" },
			);
		case "codex":
			return flow.view.kind === "codex"
				? { ...flow, view: { kind: "codex", mode: event.mode } }
				: flow;
		case "signed-in":
			return settle(
				flow,
				flow.then === "connect-database"
					? { kind: "connect-database" }
					: { kind: "connected", provider: event.provider },
			);
		case "use-login":
		case "next":
			return settle(flow, afterLogin(flow));
		case "pick":
			return go(flow, { kind: event.path });
		case "analysed":
			return {
				...flow,
				view: {
					kind: "analysis",
					connection: event.connection,
					module: event.module,
				},
			};
		case "back":
			return back(flow);
	}
}
