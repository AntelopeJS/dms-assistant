import {
	EXIT_PLAN_MODE_TOOL_NAME,
	MESSAGE_ROLES,
} from "../constants/conversation";
import type {
	AssistantMessage,
	ChangeSetMessage,
	ConversationMessage,
	ErrorMessage,
	NoticeMessage,
	QuestionAnswerMessage,
	ToolCallMessage,
	UserMessage,
} from "../types/conversation";
import { bareToolName } from "./tool-lexicon";
import { isTodoWrite } from "./todos";

/** A day boundary in the stream. */
interface SeparatorItem {
	kind: "separator";
	key: string;
	dayMs: number;
}

interface MessageItem {
	kind: "user" | "assistant" | "error" | "notice" | "change" | "answers";
	key: string;
	message:
		| UserMessage
		| AssistantMessage
		| ErrorMessage
		| NoticeMessage
		| ChangeSetMessage
		| QuestionAnswerMessage;
}

interface ToolsItem {
	kind: "tools";
	key: string;
	tools: ToolCallMessage[];
}

interface PlanItem {
	kind: "plan";
	key: string;
	tool: ToolCallMessage;
}

export type RenderItem = SeparatorItem | MessageItem | ToolsItem | PlanItem;

function startOfDay(ms: number): number {
	const date = new Date(ms);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function isPlan(message: ConversationMessage): message is ToolCallMessage {
	return (
		message.role === MESSAGE_ROLES.TOOL &&
		bareToolName(message.toolName) === EXIT_PLAN_MODE_TOOL_NAME
	);
}

interface Builder {
	out: RenderItem[];
	tools: ToolCallMessage[];
	dayMs: number | null;
}

function flushTools(builder: Builder): void {
	if (builder.tools.length === 0) return;
	const tools = builder.tools;
	builder.out.push({ kind: "tools", key: `tools-${tools[0].id}`, tools });
	builder.tools = [];
}

function markDay(builder: Builder, message: ConversationMessage): void {
	const day = startOfDay(message.timestampMs);
	if (builder.dayMs === day) return;
	builder.dayMs = day;
	builder.out.push({ kind: "separator", key: `day-${day}`, dayMs: day });
}

/** The item a message is drawn as; a tool call is drawn in a cluster instead. */
function messageItem(message: ConversationMessage): MessageItem | null {
	switch (message.role) {
		case MESSAGE_ROLES.USER:
			return { kind: "user", key: message.id, message };
		case MESSAGE_ROLES.ASSISTANT:
			return { kind: "assistant", key: message.id, message };
		case MESSAGE_ROLES.ERROR:
			return { kind: "error", key: message.id, message };
		case MESSAGE_ROLES.NOTICE:
			return { kind: "notice", key: message.id, message };
		case MESSAGE_ROLES.CHANGE_SET:
			return { kind: "change", key: message.id, message };
		case MESSAGE_ROLES.QUESTION_ANSWER:
			return { kind: "answers", key: message.id, message };
		default:
			return null;
	}
}

function place(builder: Builder, message: ConversationMessage): void {
	if (isTodoWrite(message)) return;
	if (message.role === MESSAGE_ROLES.TOOL && !isPlan(message)) {
		builder.tools.push(message);
		return;
	}
	flushTools(builder);
	if (isPlan(message)) {
		builder.out.push({ kind: "plan", key: message.id, tool: message });
		return;
	}
	const item = messageItem(message);
	if (item !== null) builder.out.push(item);
}

/**
 * The stream as drawn: day separators, consecutive tool calls in one cluster, plans as cards, steps left to the
 * dock.
 */
export function buildRenderItems(
	messages: readonly ConversationMessage[],
): RenderItem[] {
	const builder: Builder = {
		out: [],
		tools: [],
		dayMs: null,
	};
	for (const message of messages) {
		if (message.role === MESSAGE_ROLES.USER) {
			flushTools(builder);
			markDay(builder, message);
		}
		place(builder, message);
	}
	flushTools(builder);
	return builder.out;
}
