import {
	computed,
	type ComputedRef,
	onBeforeUnmount,
	type Ref,
	ref,
} from "vue";
import { z } from "zod";
import { DELETE_UNDO_MS } from "../constants/conversation";
import {
	CLIENT_MESSAGE_TYPES,
	SERVER_EVENT_TYPES,
} from "../constants/protocol";
import type { ConversationSummary } from "../types/conversation";
import type { ClientMessage } from "../types/protocol";
import { parseEvent, type WireEnvelope } from "../utils/wire-envelope";
import { PROVIDER_NAME_SCHEMA, SCOPE_SCHEMA } from "../utils/wire-schemas";

export interface UseConversationListOptions {
	send: (msg: ClientMessage) => boolean;
	onMessage: (handler: (msg: WireEnvelope) => void) => () => void;
}

/** A deletion still within its undo window. */
interface PendingDelete {
	id: string;
	title: string;
}

export interface UseConversationListResult {
	/** The sidecar's list, without the chats being deleted. */
	conversations: ComputedRef<ConversationSummary[]>;
	refresh: () => void;
	/** Hides the chat now and deletes it once the undo window is over. */
	remove: (conversation: ConversationSummary) => void;
	undoRemove: (id: string) => void;
	/** The latest deletion that can still be undone. */
	pendingDelete: Ref<PendingDelete | null>;
}

const CONVERSATION_SUMMARY_SCHEMA: z.ZodType<ConversationSummary> = z.object({
	id: z.string(),
	title: z.string(),
	createdAtMs: z.number(),
	updatedAtMs: z.number(),
	messageCount: z.number(),
	provider: PROVIDER_NAME_SCHEMA.optional(),
	totalTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	filesChanged: z.number().optional(),
	filesUndone: z.number().optional(),
	isRunning: z.boolean().optional(),
	pendingApprovals: z.number().optional(),
	pendingQuestions: z.number().optional(),
	generationMode: SCOPE_SCHEMA.optional(),
});

const CONVERSATION_LIST_SCHEMA = z.object({
	conversations: z.array(CONVERSATION_SUMMARY_SCHEMA).optional(),
});

/**
 * The conversation history. A deletion waits out its undo window on this side:
 * the sidecar only hears of it once the window is over, or at once when the
 * chat goes away.
 */
export function useConversationList(
	options: UseConversationListOptions,
): UseConversationListResult {
	const all = ref<ConversationSummary[]>([]);
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const hidden = ref<ReadonlySet<string>>(new Set());
	const pendingDelete = ref<PendingDelete | null>(null);

	options.onMessage((envelope) => {
		if (envelope.type !== SERVER_EVENT_TYPES.CONVERSATION_LIST) return;
		const event = parseEvent(CONVERSATION_LIST_SCHEMA, envelope);
		if (event !== null) all.value = event.conversations ?? [];
	});

	const setHidden = (id: string, isHidden: boolean): void => {
		const next = new Set(hidden.value);
		if (isHidden) next.add(id);
		else next.delete(id);
		hidden.value = next;
	};

	const commit = (id: string): void => {
		const timer = timers.get(id);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(id);
		options.send({
			type: CLIENT_MESSAGE_TYPES.DELETE_CONVERSATION,
			conversationId: id,
		});
		if (pendingDelete.value?.id === id) pendingDelete.value = null;
	};

	const remove = (conversation: ConversationSummary): void => {
		setHidden(conversation.id, true);
		pendingDelete.value = { id: conversation.id, title: conversation.title };
		timers.set(
			conversation.id,
			setTimeout(() => commit(conversation.id), DELETE_UNDO_MS),
		);
	};

	const undoRemove = (id: string): void => {
		const timer = timers.get(id);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(id);
		setHidden(id, false);
		if (pendingDelete.value?.id === id) pendingDelete.value = null;
	};

	onBeforeUnmount(() => [...timers.keys()].forEach(commit));

	return {
		conversations: computed(() =>
			all.value.filter((item) => !hidden.value.has(item.id)),
		),
		refresh: () => {
			options.send({ type: CLIENT_MESSAGE_TYPES.LIST_CONVERSATIONS });
		},
		remove,
		undoRemove,
		pendingDelete,
	};
}
