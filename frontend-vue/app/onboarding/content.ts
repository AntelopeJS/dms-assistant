import type { DatabaseConnection } from "../../builder/app/runtime/database-types";
import {
	CLIENT_MESSAGE_TYPES,
	SERVER_EVENT_TYPES,
} from "../chat/constants/protocol";
import type { ChatTransport } from "../runtime/chat-transport";
import { CHANNEL_STATUS_CONNECTED } from "../runtime/constants";
import type { Mockup } from "./mockups";

/** A conversation of the assistant, as Continue offers to resume it. */
export interface RecentConversation {
	id: string;
	title: string;
	updatedAtMs: number;
}

/** What the project already holds, each list latest first. */
export interface ProjectContent {
	conversations: RecentConversation[];
	mockups: Mockup[];
	/** The external databases the builder lists; the project's own is never one of them. */
	databases: DatabaseConnection[];
}

export const NO_CONTENT: ProjectContent = {
	conversations: [],
	mockups: [],
	databases: [],
};

/** At least one conversation, mockup or external database. */
export function hasContent(content: ProjectContent): boolean {
	return (
		content.conversations.length > 0 ||
		content.mockups.length > 0 ||
		content.databases.length > 0
	);
}

/** How long the conversation list may take before the project reads as having none. */
export const CONVERSATIONS_TIMEOUT_MS = 8_000;

/** The tab's stream, held open for as long as a read needs it. */
export interface ConversationStream {
	chat: ChatTransport;
	holdStream: () => () => void;
}

function conversationsOf(message: object): RecentConversation[] | null {
	if (Reflect.get(message, "type") !== SERVER_EVENT_TYPES.CONVERSATION_LIST) {
		return null;
	}
	const list: unknown = Reflect.get(message, "conversations");
	if (!Array.isArray(list)) return [];
	return list
		.filter(
			(item): item is RecentConversation =>
				item !== null &&
				typeof item === "object" &&
				typeof Reflect.get(item, "id") === "string" &&
				typeof Reflect.get(item, "title") === "string" &&
				typeof Reflect.get(item, "updatedAtMs") === "number",
		)
		.map(({ id, title, updatedAtMs }) => ({ id, title, updatedAtMs }))
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

/**
 * The assistant's conversations, asked of the sidecar over the tab's stream, which is held open
 * until it answers. No answer within `timeoutMs` reads as none.
 */
export function readConversations(
	stream: ConversationStream,
	timeoutMs = CONVERSATIONS_TIMEOUT_MS,
): Promise<RecentConversation[]> {
	return new Promise((resolve) => {
		const release = stream.holdStream();
		const ask = (): void => {
			stream.chat.send({ type: CLIENT_MESSAGE_TYPES.LIST_CONVERSATIONS });
		};
		const stops: Array<() => void> = [];
		const timer = setTimeout(() => finish([]), timeoutMs);
		function finish(list: RecentConversation[]): void {
			clearTimeout(timer);
			stops.forEach((stop) => stop());
			release();
			resolve(list);
		}
		stops.push(
			stream.chat.onMessage((message) => {
				const list = conversationsOf(message);
				if (list !== null) finish(list);
			}),
			stream.chat.onReady(ask),
		);
		if (stream.chat.getStatus() === CHANNEL_STATUS_CONNECTED) ask();
	});
}
