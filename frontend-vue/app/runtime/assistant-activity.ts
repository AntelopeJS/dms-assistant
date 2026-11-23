import { computed, type ComputedRef, type Ref, ref, watch } from "vue";
import * as z from "zod/mini";
import type { ChatTransport } from "./chat-transport";
import { CHANNEL_STATUS_CONNECTED, STATUS_POLL_MS } from "./constants";

/** The backend's `/ai/status`, as far as the tab reads it. */
export interface AssistantStatusPayload {
	pendingApprovals?: number;
	pendingQuestions?: number;
	workingConversations?: number;
	lastError?: string;
}

const ConversationListItemSchema = z.object({
	isRunning: z.optional(z.boolean()),
	pendingApprovals: z.optional(z.number()),
	pendingQuestions: z.optional(z.number()),
});

type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

const ConversationListFrameSchema = z.object({
	conversations: z.optional(z.array(ConversationListItemSchema)),
});

interface ActivityCounts {
	pendingApprovals: number;
	pendingQuestions: number;
	workingConversations: number;
}

const CONVERSATION_LIST_TYPE = "conversation_list";

export interface AssistantActivity {
	/** Requests waiting for an answer, across every chat. */
	pendingApprovals: Readonly<Ref<number>>;
	/** Questions the assistant asked and the user has not answered, across every chat. */
	pendingQuestions: Readonly<Ref<number>>;
	/** Chats running a turn now. */
	workingConversations: Readonly<Ref<number>>;
	/** A chat works or waits: the stream is worth keeping while the tab shows. */
	isBusy: ComputedRef<boolean>;
	lastError: Readonly<Ref<string | null>>;
	/** Re-reads the backend's status now. */
	refresh: () => Promise<void>;
	stop: () => void;
}

/** The read of the backend's status: `useApiData`, polled every `interval`. */
export interface AssistantStatusRead {
	data: Readonly<Ref<AssistantStatusPayload | null>>;
	/**
	 * Reads again now and drops the answer of a request still in flight. A
	 * failed read keeps `data` as it was and may resolve or reject.
	 */
	refresh: () => Promise<void>;
}

/**
 * Opens the status read, polled every `interval` ms while it is above 0 and
 * not polled while it is 0.
 */
export type OpenAssistantStatusRead = (
	interval: () => number,
) => AssistantStatusRead;

export interface AssistantActivityOptions {
	readStatus: OpenAssistantStatusRead;
	chat: ChatTransport;
	/** Whether polling is useful now: the panel is closed, or its stream is down. */
	shouldPoll: () => boolean;
}

function sum(
	items: ConversationListItem[],
	read: (item: ConversationListItem) => number,
): number {
	return items.reduce((total, item) => total + read(item), 0);
}

/**
 * What the tab knows of the assistant's work across chats, from the backend's
 * status (polled while the panel is closed or its stream down: the polling
 * follows `shouldPoll`; a failed read keeps the last answer, so the counts stay
 * as they were) and from the conversation lists the sidecar
 * broadcasts while the stream is open. Once a list arrives on a connection,
 * the lists own the counts until that connection ends: the sidecar sends one
 * on every change, and a status answer may predate the last one. Past that
 * end, a status answer counts only once the read asked again at that moment
 * has answered: one sent earlier may predate the last list. The status
 * still gives `lastError`.
 */
export function createAssistantActivity(
	options: AssistantActivityOptions,
): AssistantActivity {
	const pendingApprovals = ref(0);
	const pendingQuestions = ref(0);
	const workingConversations = ref(0);
	const lastError = ref<string | null>(null);
	const setCounts = (counts: ActivityCounts): void => {
		pendingApprovals.value = counts.pendingApprovals;
		pendingQuestions.value = counts.pendingQuestions;
		workingConversations.value = counts.workingConversations;
	};
	let doListsOwnCounts = false;
	let freshRead: { staleAnswer: AssistantStatusPayload | null } | null = null;

	const isStopped = ref(false);
	const status = options.readStatus(() =>
		!isStopped.value && options.shouldPoll() ? STATUS_POLL_MS : 0,
	);
	const setCountsFromStatus = (payload: AssistantStatusPayload): void => {
		setCounts({
			pendingApprovals: payload.pendingApprovals ?? 0,
			pendingQuestions: payload.pendingQuestions ?? 0,
			workingConversations: payload.workingConversations ?? 0,
		});
	};
	const stopFollowing = watch(
		status.data,
		(payload) => {
			if (!payload) return;
			lastError.value = payload.lastError ?? null;
			if (doListsOwnCounts || freshRead) return;
			setCountsFromStatus(payload);
		},
		{ immediate: true },
	);
	const releaseLists = (): void => {
		if (!doListsOwnCounts) return;
		doListsOwnCounts = false;
		const read = { staleAnswer: status.data.value };
		freshRead = read;
		const settle = (): void => {
			if (freshRead !== read) return;
			freshRead = null;
			const payload = status.data.value;
			if (payload && payload !== read.staleAnswer && !doListsOwnCounts)
				setCountsFromStatus(payload);
		};
		void status.refresh().then(settle, settle);
	};

	const stopListening = options.chat.onMessage((msg) => {
		if (msg.type !== CONVERSATION_LIST_TYPE) return;
		const frame = ConversationListFrameSchema.safeParse(msg);
		if (!frame.success) return;
		const items = frame.data.conversations ?? [];
		doListsOwnCounts = true;
		setCounts({
			pendingApprovals: sum(items, (item) => item.pendingApprovals ?? 0),
			pendingQuestions: sum(items, (item) => item.pendingQuestions ?? 0),
			workingConversations: sum(items, (item) =>
				item.isRunning === true ? 1 : 0,
			),
		});
	});
	const stopWatchingStream = options.chat.onStatus((next) => {
		if (next !== CHANNEL_STATUS_CONNECTED) releaseLists();
	});

	return {
		pendingApprovals,
		pendingQuestions,
		workingConversations,
		isBusy: computed(
			() =>
				pendingApprovals.value > 0 ||
				pendingQuestions.value > 0 ||
				workingConversations.value > 0,
		),
		lastError,
		refresh: () => status.refresh(),
		stop: () => {
			isStopped.value = true;
			stopFollowing();
			stopListening();
			stopWatchingStream();
		},
	};
}
