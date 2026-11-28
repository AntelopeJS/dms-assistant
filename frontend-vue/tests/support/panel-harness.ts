import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { type Mock, vi } from "vitest";
import {
	defineComponent,
	h,
	nextTick,
	readonly,
	ref,
	type Ref,
	shallowRef,
} from "vue";
import type { ChatApi } from "../../app/chat/composables/useChangeSetActions";
import type { JsonValue } from "../../app/chat/types/json";
import ChatPanel from "../../app/components/ChatPanel.vue";
import {
	ASSISTANT_SESSION_KEY,
	type AssistantSession,
	type ChatPanelState,
} from "../../app/runtime/assistant-session";
import type { ChannelStatus } from "../../app/runtime/channel-client";
import {
	type ChatTransportHub,
	createChatTransport,
} from "../../app/runtime/chat-transport";
import type { LauncherState } from "../../app/runtime/launcher-state";
import {
	createMockupRuns,
	dispatchMockupRun,
} from "../../app/runtime/mockup-runs";
import { createPanelIntents } from "../../app/runtime/panel-intents";
import {
	isTypedMessage,
	type TypedMessage,
} from "../../app/runtime/typed-message";
import {
	CHAT_I18N_KEY,
	type ChatI18n,
} from "../../app/chat/composables/useChatI18n";
import { createTestI18n } from "./i18n";
import { PANEL_STUBS } from "./stubs";
import type { SidecarStatus } from "../../app/runtime/sidecar-status";

export const CONVERSATION_ID = "conv-native-1";

/** What the stream hands the chat: the sidecar's message, as the transport hub takes it. */
export type SidecarEvent = Parameters<ChatTransportHub["deliver"]>[0];

/** A message the panel sent through the stream. */
export type SentMessage = TypedMessage;

/** A panel mounted on a fake stream: what it sent, and handles to drive it. */
export interface Harness {
	session: AssistantSession;
	hub: ChatTransportHub;
	sent: SentMessage[];
	reconnects: number;
	sidecarStatus: Ref<SidecarStatus>;
	setChannelStatus: (status: ChannelStatus) => void;
	navigate: Mock<(path: string) => void>;
	restart: Mock<() => Promise<void>>;
	lastError: Ref<string | null>;
	/** The state the session reports for the header launcher. */
	launcherState: Ref<LauncherState>;
	api: AssistantSession["api"];
	/** How many holds keep the tab's stream open. */
	streamHolds: number;
}

/**
 * What the DMS's `useSidePanel` hands the plugin: the open state it keeps in
 * its cookie, and the ways to change it.
 */
export function createSidePanel(): ChatPanelState {
	const isOpen = ref(false);
	return {
		isOpen: readonly(isOpen),
		open: () => {
			isOpen.value = true;
		},
		close: () => {
			isOpen.value = false;
		},
		toggle: () => {
			isOpen.value = !isOpen.value;
		},
	};
}

export function createHarness(): Harness {
	let channelStatus: ChannelStatus = "connected";
	const sent: SentMessage[] = [];
	const hub = createChatTransport({
		send: (msg) => {
			if (channelStatus !== "connected") return false;
			const wire: unknown = JSON.parse(JSON.stringify(msg));
			if (isTypedMessage(wire)) sent.push(wire);
			return true;
		},
		reconnect: () => {
			harness.reconnects += 1;
		},
		getStatus: () => channelStatus,
	});
	const sidecarStatus = ref<SidecarStatus>("connected");
	const navigate = vi.fn<(path: string) => void>();
	const restart = vi.fn<() => Promise<void>>(async () => undefined);
	const lastError = ref<string | null>(null);
	const launcherState = ref<LauncherState>("connected");
	const api: ChatApi = {
		get: vi.fn().mockResolvedValue({ conflicts: [] }),
		post: vi.fn(),
	};
	const panel = createSidePanel();
	const intents = createPanelIntents();
	const session: AssistantSession = {
		status: sidecarStatus,
		chat: hub.transport,
		panel,
		navigate,
		openConversation: (conversationId) => {
			intents.push({ kind: "open", conversationId });
			panel.open();
		},
		startConversation: (prompt, mode, send) => {
			intents.push({ kind: "start", prompt, mode, send });
			panel.open();
		},
		holdStream: () => {
			harness.streamHolds += 1;
			return () => {
				harness.streamHolds -= 1;
			};
		},
		pendingApprovals: ref(0),
		launcherState: readonly(launcherState),
		intents,
		runs: createMockupRuns({
			chat: hub.transport,
			storage: () => window.sessionStorage,
			emit: dispatchMockupRun,
		}),
		currentPage: ref({
			path: "/sales/overview",
			title: "Sales overview · DMS",
		}),
		api,
		lastError,
		restart,
	};
	const harness: Harness = {
		session,
		hub,
		sent,
		reconnects: 0,
		sidecarStatus,
		setChannelStatus: (status) => {
			channelStatus = status;
			hub.announceStatus(status);
		},
		navigate,
		restart,
		lastError,
		launcherState,
		api,
		streamHolds: 0,
	};
	return harness;
}

let wrapper: VueWrapper | null = null;

/** Unmounts what the last test mounted. */
export function unmountPanel(): void {
	wrapper?.unmount();
	wrapper = null;
}

/**
 * The DMS's side panel host: the panel's component is mounted while the panel
 * is open, and unmounted when it closes.
 */
function sidePanelHost(panel: ChatPanelState) {
	return defineComponent({
		setup: () => () =>
			h("aside", { "data-dms-side-panel": "" }, [
				panel.isOpen.value ? h(ChatPanel) : null,
			]),
	});
}

/** The providers the plugin installs, as a test mounts them; `i18n` is the panel's English strings unless given. */
export function providedSession(
	session: AssistantSession | null,
	i18n: ChatI18n = createTestI18n(),
) {
	return {
		[ASSISTANT_SESSION_KEY]: shallowRef(session),
		[CHAT_I18N_KEY]: i18n,
	};
}

function mountPanel(harness: Harness, i18n?: ChatI18n): VueWrapper {
	wrapper = mount(sidePanelHost(harness.session.panel), {
		attachTo: document.body,
		global: {
			provide: providedSession(harness.session, i18n),
			stubs: PANEL_STUBS,
		},
	});
	return wrapper;
}

export async function openPanel(
	harness: Harness,
	i18n?: ChatI18n,
): Promise<VueWrapper> {
	const mounted = mountPanel(harness, i18n);
	harness.session.panel.open();
	await nextTick();
	await flushPromises();
	return mounted;
}

/** A sidecar event for the panel's conversation. */
export function deliver(harness: Harness, event: SidecarEvent): void {
	harness.hub.deliver({ conversationId: CONVERSATION_ID, ...event });
}

export function sentOfType(harness: Harness, type: string) {
	return harness.sent.filter((msg) => msg.type === type);
}

/** A GET the harness has no answer for: the undo preview's empty one. */
const DEFAULT_GET_ANSWER: JsonValue = { conflicts: [] };

/**
 * Answers the panel's GETs by path, `answers[path]` or the default: the panel
 * reads the saved prompts when it opens, so a test answers its own read by
 * path rather than by order.
 */
export function answerGets(
	harness: Harness,
	answers: Record<string, JsonValue>,
): void {
	harness.api.get = vi
		.fn()
		.mockImplementation((path: string) =>
			Promise.resolve(
				Object.hasOwn(answers, path) ? answers[path] : DEFAULT_GET_ANSWER,
			),
		);
}

export async function sendMessage(
	panel: VueWrapper,
	text: string,
): Promise<void> {
	await panel.find("textarea").setValue(text);
	await panel.find("form.composer").trigger("submit");
}

/** The first button whose text contains `label`. */
export function buttonWithText(
	root: VueWrapper | ReturnType<VueWrapper["find"]>,
	label: string,
) {
	const button = root
		.findAll("button")
		.find((item) => item.text().includes(label));
	if (button === undefined) throw new Error(`no button "${label}"`);
	return button;
}
