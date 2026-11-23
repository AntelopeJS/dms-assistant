import { z } from "zod";
import {
	MESSAGE_ROLES,
	TODO_STATUS,
	TODO_WRITE_TOOL_NAME,
} from "../constants/conversation";
import type { JsonValue } from "../types/json";
import type {
	ConversationMessage,
	ToolCallMessage,
} from "../types/conversation";
import { JSON_VALUE_SCHEMA } from "./json";

type TodoItemStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	content: string;
	status: TodoItemStatus;
	activeForm: string;
}

/** A status the chat does not know reads as pending. */
const TODO_STATUS_SCHEMA: z.ZodType<TodoItemStatus> = z
	.enum([TODO_STATUS.PENDING, TODO_STATUS.IN_PROGRESS, TODO_STATUS.COMPLETED])
	.catch(TODO_STATUS.PENDING);

/** A todo without content is dropped; without a form it reads as its content. */
const TODO_SCHEMA: z.ZodType<TodoItem> = z
	.object({
		content: z.string().min(1),
		status: TODO_STATUS_SCHEMA,
		activeForm: z.string().min(1).optional().catch(undefined),
	})
	.transform(({ content, status, activeForm }) => ({
		content,
		status,
		activeForm: activeForm ?? content,
	}));

const TODO_WRITE_ARGS_SCHEMA = z.object({ todos: z.array(JSON_VALUE_SCHEMA) });

function extractTodos(args: JsonValue | undefined): TodoItem[] {
	const parsed = TODO_WRITE_ARGS_SCHEMA.safeParse(args);
	if (!parsed.success) return [];
	return parsed.data.todos.flatMap((item) => {
		const todo = TODO_SCHEMA.safeParse(item);
		return todo.success ? [todo.data] : [];
	});
}

function todoWriteOf(message: ConversationMessage): ToolCallMessage | null {
	return message.role === MESSAGE_ROLES.TOOL &&
		message.toolName === TODO_WRITE_TOOL_NAME
		? message
		: null;
}

export function isTodoWrite(message: ConversationMessage): boolean {
	return todoWriteOf(message) !== null;
}

export function latestTodos(messages: ConversationMessage[]): TodoItem[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const todoWrite = todoWriteOf(messages[i]);
		if (todoWrite === null) continue;
		return extractTodos(todoWrite.args);
	}
	return [];
}
