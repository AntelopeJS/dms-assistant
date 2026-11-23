import {
	computed,
	type ComputedRef,
	readonly,
	type Ref,
	ref,
	type ShallowRef,
	shallowRef,
	watch,
	type WritableComputedRef,
} from "vue";
import type { AssistantSession } from "../runtime/assistant-session";
import { type OnboardingApi, RefusalSchema } from "./api";
import type { ConnectMemory } from "./connect-memory";
import { hasContent, NO_CONTENT, type ProjectContent } from "./content";
import type {
	ClaudeTokenCheck,
	OnboardingState,
	ProviderName,
} from "./contract";
import {
	firstFlow,
	type FlowEvent,
	isDone,
	type OnboardingFlow,
	opensOnItsOwn,
	transition,
} from "./flow";
import type { OnboardingPreferences, PreferenceStore } from "./preferences";
import type { OnboardingStep } from "./public";

/** How often the popup asks whether the ChatGPT sign-in in the other tab completed. */
export const CODEX_POLL_MS = 2_000;

/**
 * How long after a first read of the onboarding that failed it reads again, while this tab follows
 * a connection it wrote: a page loaded while the project restarts opens on it once the backend answers.
 */
const RESUME_RETRY_MS = 2_000;

export interface OnboardingDeps {
	api: OnboardingApi;
	assistant: Pick<
		AssistantSession,
		"startConversation" | "openConversation" | "navigate"
	>;
	readContent: () => Promise<ProjectContent>;
	preferences: PreferenceStore;
	/** The builder runs, so a database can be connected. */
	canConnectDatabase: boolean;
	/** The connection this tab wrote and still follows, across a reload of the page. */
	connecting: ConnectMemory;
	openTab: (url: string) => void;
}

/** The onboarding popup's state and what its views can do with it. */
export interface OnboardingController {
	isOpen: Readonly<Ref<boolean>>;
	flow: Readonly<Ref<OnboardingFlow>>;
	state: Readonly<Ref<OnboardingState | null>>;
	content: Readonly<Ref<ProjectContent>>;
	/** The backend answered its onboarding state, so the popup can open. */
	isAvailable: ComputedRef<boolean>;
	/** Onboarding is unfinished, or the assistant's login expired: the widget shows its dot. */
	needsAttention: ComputedRef<boolean>;
	dontShow: WritableComputedRef<boolean>;
	/** Why the last action failed, until the next view. */
	problem: Readonly<Ref<string | null>>;
	canConnectDatabase: boolean;
	connecting: ConnectMemory;
	/**
	 * Reads the onboarding state and the project's content, then opens the popup if it should: on
	 * the connect form when this tab still follows a connection it wrote. Rejects when the backend
	 * does not answer its state; `open` reads again after that, and while this tab follows a
	 * connection it wrote, so does the controller itself every {@link RESUME_RETRY_MS} until `stop`.
	 */
	load: () => Promise<void>;
	/**
	 * Opens the popup, on `step` if given, else on the connect form while this tab still follows a
	 * connection it wrote, and reads the project's content again so it shows this
	 * session's conversations and mockups. While the state is unread, it opens once a read
	 * answers, and asks for that read again if the last one failed.
	 */
	open: (step?: OnboardingStep) => void;
	close: () => void;
	send: (event: FlowEvent) => void;
	/** Makes `provider` the assistant's, then moves on as the event says. */
	useLogin: (
		provider: ProviderName,
		event: "signed-in" | "use-login",
	) => Promise<void>;
	/** Reads the logins again, then moves on with `provider`'s once it works. */
	confirmLogin: (provider: ProviderName) => Promise<void>;
	checkClaudeToken: (token: string) => Promise<ClaudeTokenCheck>;
	signInWithChatGpt: () => void;
	/** Completes the sign-in from the pasted address; the refusal's message when it fails. */
	finishCodexSignIn: (url: string) => Promise<string | null>;
	/** Closes the popup and sends `prompt` as a new conversation's first message. */
	startConversation: (prompt: string) => void;
	resume: (conversationId: string) => void;
	navigate: (path: string) => void;
	stop: () => void;
}

const NO_FLOW: OnboardingFlow = {
	view: { kind: "welcome" },
	history: [],
	landing: "start",
	start: "paths",
};

/** The popup's reactive state, shared by the parts that open it and the parts that sign in. */
interface Model {
	deps: OnboardingDeps;
	isOpen: Ref<boolean>;
	flow: ShallowRef<OnboardingFlow>;
	state: ShallowRef<OnboardingState | null>;
	content: ShallowRef<ProjectContent>;
	preferences: Ref<OnboardingPreferences>;
	problem: Ref<string | null>;
	isFinished: ComputedRef<boolean>;
}

function createModel(deps: OnboardingDeps): Model {
	const state = shallowRef<OnboardingState | null>(null);
	const content = shallowRef<ProjectContent>(NO_CONTENT);
	return {
		deps,
		isOpen: ref(false),
		flow: shallowRef<OnboardingFlow>(NO_FLOW),
		state,
		content,
		preferences: ref<OnboardingPreferences>(deps.preferences.read()),
		problem: ref<string | null>(null),
		isFinished: computed(
			() =>
				state.value !== null && isDone(state.value, hasContent(content.value)),
		),
	};
}

function remember(model: Model, next: OnboardingPreferences): void {
	model.preferences.value = next;
	model.deps.preferences.write(next);
}

function firstFlowOf(
	model: Model,
	state: OnboardingState,
	step: OnboardingStep | null,
): OnboardingFlow {
	return firstFlow({
		state,
		hasContent: hasContent(model.content.value),
		canConnectDatabase: model.deps.canConnectDatabase,
		step,
	});
}

function show(
	model: Model,
	current: OnboardingState,
	step: OnboardingStep | null,
): void {
	model.problem.value = null;
	model.flow.value = firstFlowOf(model, current, step);
	model.isOpen.value = true;
	remember(model, { ...model.preferences.value, seenBootId: current.bootId });
}

async function refresh(
	model: Model,
	step: OnboardingStep | null,
	shown: OnboardingFlow,
): Promise<void> {
	const [next, project] = await Promise.all([
		model.deps.api.readState().catch(() => null),
		model.deps.readContent().catch(() => null),
	]);
	if (next !== null) model.state.value = next;
	if (project !== null) model.content.value = project;
	if (model.flow.value !== shown || model.state.value === null) return;
	model.flow.value = firstFlowOf(model, model.state.value, step);
}

function stepOrResumed(
	deps: OnboardingDeps,
	step: OnboardingStep | null,
): OnboardingStep | null {
	if (
		step !== null ||
		!deps.canConnectDatabase ||
		deps.connecting.read() === null
	) {
		return step;
	}
	return "connect-database";
}

/** Reads the state and the content, and opens the popup when it should. */
interface Opener {
	load: () => Promise<void>;
	open: (step?: OnboardingStep) => void;
	stop: () => void;
}

function createOpener(model: Model): Opener {
	const { deps } = model;
	let pendingStep: OnboardingStep | null | undefined;
	let loading: Promise<void> | undefined;
	let loadFailed = false;
	let stopped = false;
	let retry: ReturnType<typeof setTimeout> | undefined;

	function open(step?: OnboardingStep): void {
		const current = model.state.value;
		if (current === null) {
			pendingStep = step ?? pendingStep ?? null;
			if (loadFailed) void load().catch(() => undefined);
			return;
		}
		const shown = stepOrResumed(deps, step ?? null);
		show(model, current, shown);
		void refresh(model, shown, model.flow.value);
	}

	function load(): Promise<void> {
		loading ??= loadOnce().finally(() => {
			loading = undefined;
		});
		return loading;
	}

	async function loadOnce(): Promise<void> {
		let read: OnboardingState;
		let project: ProjectContent;
		try {
			[read, project] = await Promise.all([
				deps.api.readState(),
				deps.readContent().catch(() => model.content.value),
			]);
		} catch (error) {
			loadFailed = true;
			if (retry !== undefined) clearTimeout(retry);
			if (!stopped && stepOrResumed(deps, null) !== null) {
				retry = setTimeout(
					() => void load().catch(() => undefined),
					RESUME_RETRY_MS,
				);
			}
			throw error;
		}
		loadFailed = false;
		if (retry !== undefined) clearTimeout(retry);
		model.state.value = read;
		model.content.value = project;
		const step = stepOrResumed(deps, pendingStep ?? null);
		const asked = pendingStep !== undefined;
		pendingStep = undefined;
		const { preferences } = model;
		const opens =
			asked ||
			opensOnItsOwn({
				done: model.isFinished.value,
				dontShow: preferences.value.dontShow,
				bootId: read.bootId,
				seenBootId: preferences.value.seenBootId,
				step,
			});
		if (opens) show(model, read, step);
	}

	return {
		load,
		open,
		stop: () => {
			stopped = true;
			if (retry !== undefined) clearTimeout(retry);
		},
	};
}

/** What the popup does about the assistant's logins. */
interface Logins {
	send: (event: FlowEvent) => void;
	useLogin: OnboardingController["useLogin"];
	confirmLogin: OnboardingController["confirmLogin"];
	signInWithChatGpt: () => void;
	finishCodexSignIn: OnboardingController["finishCodexSignIn"];
	stop: () => void;
}

function createLogins(model: Model): Logins {
	const { deps, flow, state, problem } = model;
	let codexTimer: ReturnType<typeof setInterval> | undefined;

	function send(event: FlowEvent): void {
		problem.value = null;
		flow.value = transition(flow.value, event);
	}

	async function useLogin(
		provider: ProviderName,
		event: "signed-in" | "use-login",
	): Promise<void> {
		try {
			if (state.value?.provider !== provider) {
				state.value = await deps.api.setProvider(provider);
			}
		} catch (error) {
			problem.value = error instanceof Error ? error.message : String(error);
			return;
		}
		send(
			event === "use-login" ? { type: "use-login" } : { type: event, provider },
		);
	}

	async function confirmLogin(provider: ProviderName): Promise<void> {
		try {
			state.value = await deps.api.readState();
		} catch (error) {
			problem.value = error instanceof Error ? error.message : String(error);
			return;
		}
		if (state.value.logins[provider].status === "signed-in") {
			await useLogin(provider, "signed-in");
		}
	}

	function stopCodexPoll(): void {
		if (codexTimer !== undefined) clearInterval(codexTimer);
		codexTimer = undefined;
	}

	const waitingOnCodex = computed(() => {
		const view = flow.value.view;
		return (
			model.isOpen.value && view.kind === "codex" && view.mode === "waiting"
		);
	});

	async function pollCodex(): Promise<void> {
		const next = await deps.api.readState().catch(() => null);
		if (next === null || !waitingOnCodex.value) return;
		state.value = next;
		if (next.logins.codex.status !== "signed-in") return;
		await useLogin("codex", "signed-in");
	}

	const stopWatchingCodex = watch(waitingOnCodex, (waiting) => {
		stopCodexPoll();
		if (waiting)
			codexTimer = setInterval(() => void pollCodex(), CODEX_POLL_MS);
	});

	return {
		send,
		useLogin,
		confirmLogin,
		signInWithChatGpt: () => {
			const url = state.value?.codexLoginUrl;
			if (url === undefined) return;
			deps.openTab(url);
			send({ type: "codex", mode: "waiting" });
		},
		finishCodexSignIn: async (url) => {
			try {
				await deps.api.finishCodexSignIn(url);
			} catch (error) {
				const refusal = RefusalSchema.safeParse(error);
				if (refusal.success) return refusal.data.data.message;
				return error instanceof Error ? error.message : String(error);
			}
			await confirmLogin("codex");
			return null;
		},
		stop: () => {
			stopCodexPoll();
			stopWatchingCodex();
		},
	};
}

export function createOnboarding(deps: OnboardingDeps): OnboardingController {
	const model = createModel(deps);
	const { state, preferences } = model;
	const opener = createOpener(model);
	const logins = createLogins(model);
	return {
		isOpen: readonly(model.isOpen),
		flow: readonly(model.flow),
		state: readonly(state),
		content: computed(() => model.content.value),
		isAvailable: computed(() => state.value !== null),
		needsAttention: computed(
			() =>
				state.value !== null &&
				(!model.isFinished.value ||
					state.value.logins[state.value.provider].status === "expired"),
		),
		dontShow: computed({
			get: () => preferences.value.dontShow,
			set: (dontShow) => remember(model, { ...preferences.value, dontShow }),
		}),
		problem: readonly(model.problem),
		canConnectDatabase: deps.canConnectDatabase,
		connecting: deps.connecting,
		load: opener.load,
		open: opener.open,
		close: () => {
			model.isOpen.value = false;
		},
		send: logins.send,
		useLogin: logins.useLogin,
		confirmLogin: logins.confirmLogin,
		checkClaudeToken: (token) =>
			deps.api
				.checkClaudeToken(token)
				.catch((): ClaudeTokenCheck => ({ ok: false, reason: "unreachable" })),
		signInWithChatGpt: logins.signInWithChatGpt,
		finishCodexSignIn: logins.finishCodexSignIn,
		startConversation: (prompt) => {
			model.isOpen.value = false;
			deps.assistant.startConversation(prompt, undefined, true);
		},
		resume: (conversationId) => {
			model.isOpen.value = false;
			deps.assistant.openConversation(conversationId);
		},
		navigate: (path) => {
			model.isOpen.value = false;
			deps.assistant.navigate(path);
		},
		stop: () => {
			opener.stop();
			logins.stop();
		},
	};
}
