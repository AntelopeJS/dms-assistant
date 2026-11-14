import {
	computed,
	type ComputedRef,
	readonly,
	type Ref,
	ref,
	shallowRef,
	watch,
	type WritableComputedRef,
} from "vue";
import type { AssistantSession } from "../runtime/assistant-session";
import { type OnboardingApi, refusalMessage } from "./api";
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
import type { PreferenceStore } from "./preferences";
import type { OnboardingStep } from "./public";

/** How often the popup asks whether the ChatGPT sign-in in the other tab completed. */
export const CODEX_POLL_MS = 2_000;

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
	 * does not answer its state; `open` reads again after that.
	 */
	load: () => Promise<void>;
	/**
	 * Opens the popup, on `step` if given, and reads the project's content again so it shows this
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
	then: "start",
	start: "paths",
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createOnboarding(deps: OnboardingDeps): OnboardingController {
	const isOpen = ref(false);
	const flow = shallowRef<OnboardingFlow>(NO_FLOW);
	const state = shallowRef<OnboardingState | null>(null);
	const content = shallowRef<ProjectContent>(NO_CONTENT);
	const preferences = ref(deps.preferences.read());
	const problem = ref<string | null>(null);
	let pendingStep: OnboardingStep | null | undefined;
	let codexTimer: ReturnType<typeof setInterval> | undefined;
	let loading: Promise<void> | undefined;
	let loadFailed = false;

	const done = computed(
		() =>
			state.value !== null && isDone(state.value, hasContent(content.value)),
	);

	function remember(next: typeof preferences.value): void {
		preferences.value = next;
		deps.preferences.write(next);
	}

	function show(current: OnboardingState, step: OnboardingStep | null): void {
		problem.value = null;
		flow.value = firstFlow({
			state: current,
			hasContent: hasContent(content.value),
			canConnectDatabase: deps.canConnectDatabase,
			step,
		});
		isOpen.value = true;
		remember({ ...preferences.value, seenBootId: current.bootId });
	}

	async function refresh(step: OnboardingStep | null, shown: OnboardingFlow) {
		const [next, project] = await Promise.all([
			deps.api.readState().catch(() => null),
			deps.readContent().catch(() => null),
		]);
		if (next !== null) state.value = next;
		if (project !== null) content.value = project;
		if (flow.value !== shown || state.value === null) return;
		flow.value = firstFlow({
			state: state.value,
			hasContent: hasContent(content.value),
			canConnectDatabase: deps.canConnectDatabase,
			step,
		});
	}

	function open(step?: OnboardingStep): void {
		const current = state.value;
		if (current === null) {
			pendingStep = step ?? pendingStep ?? null;
			if (loadFailed) void load().catch(() => undefined);
			return;
		}
		show(current, step ?? null);
		void refresh(step ?? null, flow.value);
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
				deps.readContent().catch(() => content.value),
			]);
		} catch (error) {
			loadFailed = true;
			throw error;
		}
		loadFailed = false;
		state.value = read;
		content.value = project;
		const step =
			pendingStep ??
			(deps.connecting.read() === null ? null : "connect-database");
		const asked = pendingStep !== undefined;
		pendingStep = undefined;
		const opens =
			asked ||
			opensOnItsOwn({
				done: done.value,
				dontShow: preferences.value.dontShow,
				bootId: read.bootId,
				seenBootId: preferences.value.seenBootId,
				step,
			});
		if (opens) show(read, step);
	}

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
			problem.value = messageOf(error);
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
			problem.value = messageOf(error);
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
		return isOpen.value && view.kind === "codex" && view.mode === "waiting";
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
		isOpen: readonly(isOpen),
		flow: readonly(flow),
		state: readonly(state),
		content: computed(() => content.value),
		isAvailable: computed(() => state.value !== null),
		needsAttention: computed(
			() =>
				state.value !== null &&
				(!done.value ||
					state.value.logins[state.value.provider].status === "expired"),
		),
		dontShow: computed({
			get: () => preferences.value.dontShow,
			set: (dontShow) => remember({ ...preferences.value, dontShow }),
		}),
		problem: readonly(problem),
		canConnectDatabase: deps.canConnectDatabase,
		connecting: deps.connecting,
		load,
		open,
		close: () => {
			isOpen.value = false;
		},
		send,
		useLogin,
		confirmLogin,
		checkClaudeToken: (token) =>
			deps.api
				.checkClaudeToken(token)
				.catch((): ClaudeTokenCheck => ({ ok: false, reason: "unreachable" })),
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
				return refusalMessage(error) ?? messageOf(error);
			}
			await confirmLogin("codex");
			return null;
		},
		startConversation: (prompt) => {
			isOpen.value = false;
			deps.assistant.startConversation(prompt, undefined, true);
		},
		resume: (conversationId) => {
			isOpen.value = false;
			deps.assistant.openConversation(conversationId);
		},
		navigate: (path) => {
			isOpen.value = false;
			deps.assistant.navigate(path);
		},
		stop: () => {
			stopCodexPoll();
			stopWatchingCodex();
		},
	};
}
