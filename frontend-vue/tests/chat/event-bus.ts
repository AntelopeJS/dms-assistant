import { type Ref, ref } from "vue";
import type { ClientMessage } from "../../app/chat/types/protocol";
import type { WireEnvelope } from "../../app/chat/utils/wire-envelope";

/** What the chat's composables take of the stream: the active chat and both directions. */
export interface BusOptions {
	activeId: Ref<string>;
	send: (msg: ClientMessage) => boolean;
	onMessage: (handler: (msg: WireEnvelope) => void) => () => void;
}

/** The sidecar's side of the stream, for a chat on one conversation. */
export interface EventBus {
	/** What the chat sent while the stream was connected. */
	sent: ClientMessage[];
	/** Delivers an event of the conversation to everything listening. */
	receive: (event: WireEnvelope) => void;
	setConnected: (isConnected: boolean) => void;
	options: BusOptions;
}

export function createEventBus(conversationId: string): EventBus {
	const sent: ClientMessage[] = [];
	const handlers: ((msg: WireEnvelope) => void)[] = [];
	let isConnected = true;
	return {
		sent,
		receive: (event) =>
			handlers.forEach((handler) => handler({ conversationId, ...event })),
		setConnected: (value) => {
			isConnected = value;
		},
		options: {
			activeId: ref(conversationId),
			send: (msg) => {
				if (!isConnected) return false;
				sent.push(msg);
				return true;
			},
			onMessage: (handler) => {
				handlers.push(handler);
				return () => undefined;
			},
		},
	};
}
