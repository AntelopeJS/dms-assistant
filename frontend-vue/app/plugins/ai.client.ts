import {
	type DmsAppContext,
	type DmsI18n,
	defineDmsPlugin,
	useDmsRouter,
} from "#dms/frontend-module";
import { type App, computed, ref, shallowRef, type ShallowRef } from "vue";
import { CHAT_I18N_KEY, type ChatI18n } from "../chat/composables/useChatI18n";
import type { ChatApi } from "../chat/composables/useChangeSetActions";
import type { CurrentPage } from "../chat/types/conversation";
import type { OnboardingController } from "../onboarding/controller";
import { startOnboarding } from "../onboarding/install";
import { ONBOARDING_KEY } from "../onboarding/public";
import {
	ONBOARDING_CONTROLLER_KEY,
	publicOnboarding,
} from "../onboarding/runtime";
import {
	type AssistantStatusPayload,
	createAssistantActivity,
} from "../runtime/assistant-activity";
import {
	paletteAssistant,
	paletteSource,
	registerLauncher,
} from "../runtime/assistant-commands";
import {
	ASSISTANT_ACTIONS_KEY,
	publicAssistantActions,
} from "../runtime/assistant-actions";
import {
	createAssistantChannel,
	followPanel,
	followSidecarStatus,
	installHostState,
} from "../runtime/assistant-channel";
import { installAssistantNotifications } from "../runtime/assistant-notifications";
import {
	ASSISTANT_SESSION_KEY,
	type AssistantSession,
	type ChatPanelState,
} from "../runtime/assistant-session";
import { createSession, jsonPost } from "../runtime/assistant-session-factory";
import {
	CHANGES_PATH,
	RESTART_PATH,
	SIDECAR_INFO_PATH,
	SIDECAR_STATUS_CONNECTED,
	SIDE_PANEL_ID,
	STATUS_PATH,
} from "../runtime/constants";
import { installAssistantPromptListener } from "../runtime/assistant-prompt";
import { isEmbedded } from "../runtime/embedding";
import {
	createHostCommandDispatcher,
	createNavigator,
} from "../runtime/host-commands";
import { createLauncherState } from "../runtime/launcher-state";
import { createMockupFold } from "../runtime/mockup-fold";
import { mountFoldBar } from "../runtime/fold-bar";
import {
	createMockupRuns,
	dispatchMockupRun,
	installMockupRunAnswers,
	routePrompt,
} from "../runtime/mockup-runs";
import { runWhenLoggedIn } from "../runtime/session-gate";
import { installToggleShortcut } from "../runtime/shortcuts";
import {
	createSidecarStatusController,
	type SidecarInfoPayload,
	type SidecarStatusController,
} from "../runtime/sidecar-status";
import { createStreamHolds } from "../runtime/stream-holds";
import type { TypedMessage } from "../runtime/typed-message";

type AuthFetch = ReturnType<typeof useAuthFetch>["$authFetch"];
type Toaster = ReturnType<typeof useToast>;

function createChatI18n(i18n: DmsI18n): ChatI18n {
	return {
		t: (key, params, plural) =>
			plural === undefined
				? i18n.t(key, params ?? {})
				: i18n.t(key, params ?? {}, plural),
		locale: computed(() => String(i18n.locale.value)),
	};
}

type PostBody = Parameters<ChatApi["post"]>[1];

function createApi($authFetch: AuthFetch): ChatApi {
	return {
		get: <T>(path: string) => $authFetch<T>(path),
		post: <T>(path: string, body?: PostBody) =>
			$authFetch<T>(path, jsonPost(JSON.stringify(body ?? {}))),
	};
}

/** What the plugin takes from the DMS before its first await, while in context. */
interface DashboardDeps {
	$authFetch: AuthFetch;
	toaster: Toaster;
	devReload: ReturnType<typeof useDevReload>;
	router: ReturnType<typeof useDmsRouter>;
}

function installFold(app: App, session: AssistantSession): () => void {
	const router = useDmsRouter();
	const fold = createMockupFold({
		path: computed(() => router.currentRoute.value.path),
		panel: session.panel,
	});
	const unmountBar = mountFoldBar(app, fold, session.launcherState);
	const stopPrompts = installAssistantPromptListener((prompt) => {
		session.intents.push(routePrompt(prompt, session.runs));
		fold.unfold();
	});
	return () => {
		stopPrompts();
		unmountBar();
		fold.stop();
	};
}

function registerDashboardEntries(
	session: AssistantSession,
	i18n: ChatI18n,
): () => void {
	const stopWatchingLauncher = registerLauncher(
		i18n.t,
		session.launcherState,
		registerHeaderAction,
	);
	registerCommandPaletteSource(
		paletteSource(i18n.t, session.pendingApprovals, {
			ask: () => {
				session.intents.push({ kind: "focus" });
				session.panel.open();
			},
			startConversation: () => session.startConversation(),
			reviewApprovals: () => {
				session.intents.push({ kind: "approvals" });
				session.panel.open();
			},
			openChanges: () => session.navigate(CHANGES_PATH),
		}),
	);
	registerCommandPaletteAssistant(
		paletteAssistant(i18n.t, session.currentPage),
	);
	return stopWatchingLauncher;
}

/** The message that asks the sidecar to undo a change set. */
interface ChangeSetActionMessage extends TypedMessage {
	conversationId: string;
	changeSetId: string;
	action: "undo";
}

function installToasts(
	session: AssistantSession,
	i18n: ChatI18n,
	toaster: Toaster,
): () => void {
	return installAssistantNotifications({
		chat: session.chat,
		isPanelOpen: session.panel.isOpen,
		pendingApprovals: session.pendingApprovals,
		t: i18n.t,
		toast: (input) => void toaster.add(input),
		reviewApprovals: (conversationId) => {
			if (conversationId !== undefined)
				session.openConversation(conversationId);
			session.intents.push({ kind: "approvals" });
			session.panel.open();
		},
		undoChangeSet: (set) => {
			const undo: ChangeSetActionMessage = {
				type: "change_set_action",
				conversationId: set.conversationId,
				changeSetId: set.id,
				action: "undo",
			};
			session.chat.send(undo);
		},
		reviewChangeSet: (id) =>
			session.navigate(`${CHANGES_PATH}?set=${encodeURIComponent(id)}`),
	});
}

/**
 * The launcher and the palette entries join the dashboard only once the app is
 * mounted: the server renders neither, and anything added before hydration
 * would make the client's tree, and the ids its tooltips and menus draw,
 * differ from the server's. The panel itself is registered on the server too
 * (`side-panel.ts`).
 */
function registerOnceMounted(
	context: DmsAppContext,
	appMounted: Promise<void>,
	session: AssistantSession,
	i18n: ChatI18n,
): () => void {
	let stop: (() => void) | null = null;
	let isActive = true;
	void appMounted.then(() => {
		if (!isActive) return;
		context.runWithContext(() => {
			const stopEntries = registerDashboardEntries(session, i18n);
			const stopFold = installFold(context.vueApp, session);
			stop = () => {
				stopEntries();
				stopFold();
			};
		});
	});
	return () => {
		isActive = false;
		stop?.();
	};
}

/** What the plugin provides the app before the assistant runs. */
interface ProvidedAssistant {
	session: ShallowRef<AssistantSession | null>;
	onboarding: ShallowRef<OnboardingController | null>;
	i18n: ChatI18n;
}

/** The parts of the module the backend turned on. */
export interface AssistantFeatures {
	/** The builder runs, so the onboarding offers to connect a database. */
	builderEnabled: boolean;
}

interface AssistantRuntime {
	session: AssistantSession;
	stops: Array<() => void>;
}

/**
 * Builds the tab's stream, the activity read of the backend's status, which
 * the application polls for as long as it runs while the interval says so, and
 * the session the panel and the pages share.
 */
function createRuntime(
	deps: DashboardDeps,
	controller: SidecarStatusController,
): AssistantRuntime {
	const navigate = createNavigator({
		router: deps.router,
		devReload: deps.devReload,
		location: () => window.location.pathname,
	});
	const dispatchHostCommand = createHostCommandDispatcher({ navigate });
	const { client, chat } = createAssistantChannel({
		post: async (path, body) => {
			await deps.$authFetch(path, jsonPost(JSON.stringify(body)));
		},
		controller,
		dispatchHostCommand,
	});
	const panel: ChatPanelState = useSidePanel(SIDE_PANEL_ID);
	const holds = createStreamHolds();
	const sidecarStatus = followSidecarStatus(controller, client);
	const activity = createAssistantActivity({
		readStatus: (interval) =>
			useApiData<AssistantStatusPayload>(STATUS_PATH, {
				refreshInterval: interval,
				refreshOnPageRefresh: false,
			}),
		chat: chat.transport,
		shouldPoll: () =>
			!panel.isOpen.value ||
			sidecarStatus.status.value !== SIDECAR_STATUS_CONNECTED,
	});
	const launcher = createLauncherState({
		isConnected: computed(
			() => sidecarStatus.status.value === SIDECAR_STATUS_CONNECTED,
		),
		working: activity.workingConversations,
		waiting: computed(
			() => activity.pendingApprovals.value + activity.pendingQuestions.value,
		),
		isPanelOpen: panel.isOpen,
	});
	const currentPage = ref<CurrentPage | null>(null);
	const runs = createMockupRuns({
		chat: chat.transport,
		storage: () => window.sessionStorage,
		emit: dispatchMockupRun,
	});
	const session = createSession({
		api: createApi(deps.$authFetch),
		restartBackend: async () => {
			await deps.$authFetch(RESTART_PATH, jsonPost("{}"));
		},
		controller,
		chat,
		panel,
		holds,
		status: sidecarStatus.status,
		activity,
		launcher,
		currentPage,
		navigate,
		runs,
	});
	const stops = [
		runs.stop,
		installToggleShortcut({ onToggle: panel.toggle }),
		followPanel({ panel, activity, holds }, client),
		installHostState(client, currentPage),
		sidecarStatus.stop,
		activity.stop,
		launcher.stop,
		controller.dispose,
		client.stop,
	];
	return { session, stops };
}

interface WireOptions {
	context: DmsAppContext;
	appMounted: Promise<void>;
	provided: ProvidedAssistant;
	toaster: Toaster;
	router: DashboardDeps["router"];
	features: AssistantFeatures;
}

function wireAssistant(
	options: WireOptions,
	runtime: AssistantRuntime,
): () => void {
	const { context, appMounted, provided } = options;
	const { session } = runtime;
	const { user } = useDmsUserSession<{ _id: string }>();
	provided.session.value = session;
	const stops = [
		installMockupRunAnswers(session.runs),
		registerOnceMounted(context, appMounted, session, provided.i18n),
		installToasts(session, provided.i18n, options.toaster),
		startOnboarding({
			session,
			router: options.router,
			provided: provided.onboarding,
			canConnectDatabase: options.features.builderEnabled,
			userId: () => user.value?._id ?? null,
			appMounted,
			runWithContext: (callback) => context.runWithContext(callback),
		}),
		...runtime.stops,
	];
	return () => {
		provided.session.value = null;
		stops.forEach((stop) => stop());
	};
}

/**
 * Takes what it needs from the DMS before its first await, reads the sidecar
 * once the gate opens, then polls it while the sidecar comes back.
 */
async function startAssistant(
	context: DmsAppContext,
	appMounted: Promise<void>,
	provided: ProvidedAssistant,
	features: AssistantFeatures,
): Promise<void> {
	const deps: DashboardDeps = {
		$authFetch: useAuthFetch().$authFetch,
		toaster: useToast(),
		devReload: useDevReload(),
		router: useDmsRouter(),
	};
	const controller = createSidecarStatusController((interval) =>
		useApiData<SidecarInfoPayload>(SIDECAR_INFO_PATH, {
			immediate: false,
			refreshInterval: interval,
			refreshOnPageRefresh: false,
		}),
	);
	if (!(await controller.init())) {
		context.runWithContext(() => unregisterSidePanel(SIDE_PANEL_ID));
		return;
	}
	const teardown = context.runWithContext(() =>
		wireAssistant(
			{
				context,
				appMounted,
				provided,
				toaster: deps.toaster,
				router: deps.router,
				features,
			},
			createRuntime(deps, controller),
		),
	);
	context.vueApp.onUnmount(teardown);
	import.meta.hot?.dispose(teardown);
}

/**
 * The assistant appears for a signed-in owner in development only: a first
 * probe that finds no dms-assistant backend, or a disabled sidecar, leaves no trace.
 * The session and the onboarding are provided at once, empty until that probe
 * answers, so the panel the server rendered open and the workspace pages
 * follow them, and another module's layer finds the public onboarding. A
 * dashboard drawn in a frame (the mockup beside a build's comparison) runs no
 * assistant of its own: it would open a second stream of the same chats.
 */
export function assistantPlugin(features: AssistantFeatures) {
	return defineDmsPlugin((context) => {
		if (!import.meta.env.DEV) return;
		const provided: ProvidedAssistant = {
			session: shallowRef<AssistantSession | null>(null),
			onboarding: shallowRef<OnboardingController | null>(null),
			i18n: createChatI18n(context.$i18n),
		};
		context.vueApp.provide(ASSISTANT_SESSION_KEY, provided.session);
		context.vueApp.provide(
			ASSISTANT_ACTIONS_KEY,
			publicAssistantActions(provided.session),
		);
		context.vueApp.provide(ONBOARDING_CONTROLLER_KEY, provided.onboarding);
		context.vueApp.provide(
			ONBOARDING_KEY,
			publicOnboarding(provided.onboarding),
		);
		context.vueApp.provide(CHAT_I18N_KEY, provided.i18n);
		if (isEmbedded(globalThis)) {
			context.runWithContext(() => unregisterSidePanel(SIDE_PANEL_ID));
			return;
		}
		const appMounted = new Promise<void>((resolve) =>
			context.hook("app:mounted", resolve),
		);
		const { loggedIn } = useDmsUserSession();
		const stopGate = runWhenLoggedIn(
			() => loggedIn.value,
			() =>
				void context.runWithContext(() =>
					startAssistant(context, appMounted, provided, features),
				),
		);
		context.vueApp.onUnmount(stopGate);
	});
}
