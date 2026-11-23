import type { Ref } from "vue";
import { CLIENT_MESSAGE_TYPES } from "../constants/protocol";
import type { QueuedMessage } from "../types/conversation";
import type { ClientMessage } from "../types/protocol";
import { moveItem } from "../utils/queue";

export interface UseQueueActionsOptions {
	activeId: Ref<string>;
	queued: Ref<QueuedMessage[]>;
	send: (msg: ClientMessage) => boolean;
}

export interface UseQueueActionsResult {
	cancel: (id: string) => void;
	update: (id: string, content: string) => void;
	move: (id: string, toIndex: number) => void;
	clear: () => void;
}

/**
 * Edits to the follow-up queue. The sidecar owns it and answers each change
 * with the new `queue_state`; the chat shows the change at once meanwhile.
 */
export function useQueueActions(
	options: UseQueueActionsOptions,
): UseQueueActionsResult {
	return {
		cancel: (id) => {
			const isSent = options.send({
				type: CLIENT_MESSAGE_TYPES.QUEUE_CANCEL,
				conversationId: options.activeId.value,
				id,
			});
			if (!isSent) return;
			options.queued.value = options.queued.value.filter(
				(item) => item.id !== id,
			);
		},
		update: (id, content) => {
			const isSent = options.send({
				type: CLIENT_MESSAGE_TYPES.QUEUE_UPDATE,
				conversationId: options.activeId.value,
				id,
				content,
			});
			if (!isSent) return;
			options.queued.value = options.queued.value.map((item) =>
				item.id === id ? { ...item, content } : item,
			);
		},
		move: (id, toIndex) => {
			const isSent = options.send({
				type: CLIENT_MESSAGE_TYPES.QUEUE_MOVE,
				conversationId: options.activeId.value,
				id,
				toIndex,
			});
			if (!isSent) return;
			options.queued.value = moveItem(options.queued.value, id, toIndex);
		},
		clear: () => {
			const isSent = options.send({
				type: CLIENT_MESSAGE_TYPES.QUEUE_CLEAR,
				conversationId: options.activeId.value,
			});
			if (!isSent) return;
			options.queued.value = [];
		},
	};
}
