import { onBeforeUnmount, onMounted, type Ref, ref } from "vue";
import type { ChatTransport } from "../../runtime/chat-transport";
import { createListeners } from "../../runtime/listeners";
import {
	CHAT_ROLE,
	CLIENT_MESSAGE_TYPES,
	CONNECTION_STATUSES,
	type ConnectionStatus,
} from "../constants/protocol";
import type { ClientMessage, HelloMessage } from "../types/protocol";
import { readEnvelope, type WireEnvelope } from "../utils/wire-envelope";

export interface UseChatChannelOptions {
	transport: ChatTransport;
	getConversationId: () => string;
	/**
	 * Follows the conversation next to the one the tab's stream shows, rather
	 * than switching it: the command palette's answer, while the panel keeps
	 * its own chat.
	 */
	isFollowing?: boolean;
}

type ChannelMessageHandler = (msg: WireEnvelope) => void;

export interface UseChatChannelResult {
	/** False when the message was dropped: the stream is not connected. */
	send: (msg: ClientMessage) => boolean;
	onMessage: (handler: ChannelMessageHandler) => () => void;
	reconnect: () => void;
	reidentify: () => void;
	isConnected: Ref<boolean>;
	connectionStatus: Ref<ConnectionStatus>;
}

interface ChannelState {
	options: UseChatChannelOptions;
	emit: ChannelMessageHandler;
	isConnected: Ref<boolean>;
	connectionStatus: Ref<ConnectionStatus>;
	isAttached: boolean;
	detachers: Array<() => void>;
}

function setStatus(state: ChannelState, status: ConnectionStatus): void {
	state.connectionStatus.value = status;
	state.isConnected.value = status === CONNECTION_STATUSES.CONNECTED;
}

function sendHello(state: ChannelState): void {
	const { transport, getConversationId, isFollowing } = state.options;
	const hello: HelloMessage = {
		type: CLIENT_MESSAGE_TYPES.HELLO,
		role: CHAT_ROLE,
		conversationId: getConversationId(),
	};
	if (isFollowing === true) hello.follow = true;
	transport.send(hello);
}

function attach(state: ChannelState): void {
	const { transport } = state.options;
	state.isAttached = true;
	state.detachers = [
		transport.onMessage((message) => {
			const envelope = readEnvelope(message);
			if (envelope !== null) state.emit(envelope);
		}),
		transport.onReady(() => sendHello(state)),
		transport.onStatus((status) => setStatus(state, status)),
	];
	setStatus(state, transport.getStatus());
	if (state.isConnected.value) sendHello(state);
}

function detach(state: ChannelState): void {
	state.isAttached = false;
	for (const stop of state.detachers) stop();
	state.detachers = [];
}

export interface ChatChannel {
	result: UseChatChannelResult;
	/** Listens to the dashboard's stream and says hello once it is connected. */
	start: () => void;
	/** Stops listening: no message reaches the chat after this. */
	stop: () => void;
}

/** The chat's channel without the component lifecycle, which `useChatChannel` adds. */
export function createChatChannel(options: UseChatChannelOptions): ChatChannel {
	const subscribers = createListeners<WireEnvelope>();
	const state: ChannelState = {
		options,
		emit: subscribers.emit,
		isConnected: ref(false),
		connectionStatus: ref<ConnectionStatus>(CONNECTION_STATUSES.CONNECTING),
		isAttached: false,
		detachers: [],
	};
	return {
		result: {
			send: (msg) => state.isAttached && options.transport.send(msg),
			onMessage: subscribers.add,
			reconnect: () => options.transport.reconnect(),
			reidentify: () => sendHello(state),
			isConnected: state.isConnected,
			connectionStatus: state.connectionStatus,
		},
		start: () => attach(state),
		stop: () => detach(state),
	};
}

/**
 * The chat's channel to the sidecar: its side of the dashboard's one stream per
 * tab. A `hello` with the conversation goes out on every (re)connection, and
 * the chat stops listening when it unmounts.
 */
export function useChatChannel(
	options: UseChatChannelOptions,
): UseChatChannelResult {
	const channel = createChatChannel(options);
	onMounted(channel.start);
	onBeforeUnmount(channel.stop);
	return channel.result;
}
