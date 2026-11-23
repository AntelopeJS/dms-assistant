import { readonly, type Ref, ref, watch } from "vue";
import type { CurrentPage } from "../chat/types/conversation";
import type { AssistantActivity } from "./assistant-activity";
import type { ChatPanelState } from "./assistant-session";
import { type ChannelClient, createChannelClient } from "./channel-client";
import { type ChatTransportHub, createChatTransport } from "./chat-transport";
import {
	CHANNEL_IDLE_STOP_MS,
	CHANNEL_STATUS_RECONNECTING,
	HELLO_MESSAGE_TYPE,
	HOST_ROLE,
	SIDECAR_STATUS_CONNECTED,
	SIDECAR_STATUS_REVIVING,
	VISIBILITY_CHANGE_EVENT,
} from "./constants";
import {
	buildCurrentPageUpdate,
	installCurrentPageTracker,
} from "./current-page";
import { createFrameRouter } from "./frame-router";
import type { HostCommandDispatcher } from "./host-commands";
import { installNavigationCompleteEmitter } from "./navigation-complete";
import type { SidecarStatus, SidecarStatusController } from "./sidecar-status";
import type { StreamHolds } from "./stream-holds";
import type { TypedMessage } from "./typed-message";

export interface ChannelDeps {
	/** Posts one message to the stream's messages route, authenticated as the dashboard is. */
	post: (path: string, body: TypedMessage) => Promise<void>;
	controller: SidecarStatusController;
	dispatchHostCommand: HostCommandDispatcher;
}

export interface AssistantChannel {
	client: ChannelClient;
	chat: ChatTransportHub;
}

/** What the dashboard says first on each connection, to be identified as the host. */
interface HostHelloMessage extends TypedMessage {
	role: string;
}

export function createAssistantChannel(deps: ChannelDeps): AssistantChannel {
	const chat = createChatTransport({
		send: (msg) => client.send(msg),
		reconnect: () => client.reconnectNow(),
		getStatus: () => client.getStatus(),
	});
	const client = createChannelClient({
		post: deps.post,
		onReady: () => {
			const hello: HostHelloMessage = {
				type: HELLO_MESSAGE_TYPE,
				role: HOST_ROLE,
			};
			client.send(hello);
			client.send(buildCurrentPageUpdate(window.location.href));
			chat.announceReady();
		},
		onFrame: createFrameRouter({
			host: deps.dispatchHostCommand,
			chat: chat.deliver,
		}),
		onStatusChange: (status) => {
			chat.announceStatus(status);
			if (status === CHANNEL_STATUS_RECONNECTING)
				deps.controller.reportChannelDown();
		},
	});
	return { client, chat };
}

/** What keeps the tab's stream open. */
export interface StreamNeeds {
	panel: ChatPanelState;
	activity: AssistantActivity;
	holds: StreamHolds;
}

/**
 * The stream is open while the panel is, while the tab shows a chat that
 * works or waits, so its events (and their toasts) still arrive, and while the
 * command palette streams an answer; otherwise it gives its connection back
 * shortly after.
 */
export function followPanel(
	needs: StreamNeeds,
	client: ChannelClient,
): () => void {
	const { panel, activity, holds } = needs;
	let stopTimer: ReturnType<typeof setTimeout> | null = null;
	const clearStopTimer = (): void => {
		if (stopTimer !== null) clearTimeout(stopTimer);
		stopTimer = null;
	};
	const follow = (): void => {
		clearStopTimer();
		const isVisible = document.visibilityState === "visible";
		const isWanted =
			panel.isOpen.value || activity.isBusy.value || holds.isHeld.value;
		if (isVisible && isWanted) client.start();
		else stopTimer = setTimeout(() => client.stop(), CHANNEL_IDLE_STOP_MS);
	};
	const stopWatching = watch(
		[panel.isOpen, activity.isBusy, holds.isHeld],
		follow,
	);
	document.addEventListener(VISIBILITY_CHANGE_EVENT, follow);
	follow();
	return () => {
		clearStopTimer();
		stopWatching();
		document.removeEventListener(VISIBILITY_CHANGE_EVENT, follow);
	};
}

export interface FollowedSidecarStatus {
	status: Readonly<Ref<SidecarStatus>>;
	stop: () => void;
}

/**
 * Mirrors the sidecar's status. Only a sidecar coming back needs a fresh
 * stream: replacing the one that just opened would re-attach every chat and
 * replay its running turn.
 */
export function followSidecarStatus(
	controller: SidecarStatusController,
	client: ChannelClient,
): FollowedSidecarStatus {
	const status = ref<SidecarStatus>(controller.getStatus());
	const stop = controller.subscribe((next) => {
		if (
			next === SIDECAR_STATUS_CONNECTED &&
			status.value === SIDECAR_STATUS_REVIVING
		)
			client.reconnectNow();
		status.value = next;
	});
	return { status: readonly(status), stop };
}

/** Reports the dashboard's page and its navigations to the sidecar while the stream is connected. */
export function installHostState(
	client: ChannelClient,
	currentPage: Ref<CurrentPage | null>,
): () => void {
	const sendWhenConnected = (msg: TypedMessage): void => {
		if (!client.isConnected()) return;
		client.send(msg);
	};
	const stopTracking = installCurrentPageTracker({
		send: (msg) => {
			currentPage.value = msg.currentPage;
			sendWhenConnected(msg);
		},
	});
	const stopNavigation = installNavigationCompleteEmitter({
		send: sendWhenConnected,
	});
	return () => {
		stopTracking();
		stopNavigation();
	};
}
