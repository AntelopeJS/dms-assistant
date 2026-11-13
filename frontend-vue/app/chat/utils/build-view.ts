import { MESSAGE_ROLES } from "../constants/conversation";
import type {
	BlockPreviewMessage,
	ConversationMessage,
	ToolCallMessage,
} from "../types/conversation";
import { type ReferenceView, referenceView } from "./block-preview";
import { latestTodos, type TodoItem } from "./todos";
import {
	bareToolName,
	describeTool,
	type ToolDescription,
} from "./tool-lexicon";

export type BuildStepState =
	| "done"
	| "running"
	| "pending"
	| "failed"
	| "stopped";

/**
 * Where the build stands: still running, built, ended on an error or a failed
 * last step, or stopped before it finished.
 */
export type BuildOutcome = "running" | "built" | "failed" | "stopped";

/** One line of the build dialog's checklist: a todo of the build, or one of its tool calls. */
export type BuildStep =
	| { key: string; state: BuildStepState; kind: "todo"; text: string }
	| { key: string; state: BuildStepState; kind: "tool"; tool: ToolDescription };

/** What the build dialog shows of the turn that builds a mockup. */
export interface BuildView {
	mockup: string;
	steps: BuildStep[];
	/** The latest comparison the build drew: its block preview, with the mockup beside it. */
	comparison: BlockPreviewMessage | null;
	/** The mockup that comparison is drawn against. */
	reference: ReferenceView | null;
	outcome: BuildOutcome;
	/** The last dashboard page the build worked on, to open once it is done. */
	pagePath: string | null;
}

const PAGE_ARGS = ["page", "pageRef"] as const;
const PAGE_PATH_PREFIX = "/";
const PAGE_SEPARATOR = "#";

const TODO_STATES: Record<TodoItem["status"], BuildStepState> = {
	completed: "done",
	in_progress: "running",
	pending: "pending",
};

function sinceLastRequest(
	messages: readonly ConversationMessage[],
): ConversationMessage[] {
	const start = messages.findLastIndex(
		(message) => message.role === MESSAGE_ROLES.USER,
	);
	return messages.slice(start + 1);
}

function isToolCall(message: ConversationMessage): message is ToolCallMessage {
	return message.role === MESSAGE_ROLES.TOOL;
}

const FAILED_OUTCOMES: ReadonlySet<string> = new Set([
	"failed",
	"denied",
	"blocked",
]);

function toolState(tool: ToolCallMessage, isRunning: boolean): BuildStepState {
	if (tool.outcome === "stopped") return "stopped";
	if (tool.status === "error" || FAILED_OUTCOMES.has(tool.outcome ?? ""))
		return "failed";
	if (tool.status === "success") return "done";
	return isRunning ? "running" : "stopped";
}

function outcomeOf(
	turn: readonly ConversationMessage[],
	isRunning: boolean,
): BuildOutcome {
	if (isRunning || turn.length === 0) return "running";
	if (turn.some((message) => message.role === MESSAGE_ROLES.ERROR))
		return "failed";
	const calls = turn.filter(isToolCall);
	if (calls.some((tool) => toolState(tool, false) === "stopped"))
		return "stopped";
	const last = calls.at(-1);
	return last !== undefined && toolState(last, false) === "failed"
		? "failed"
		: "built";
}

function stepsOf(
	turn: readonly ConversationMessage[],
	isRunning: boolean,
): BuildStep[] {
	const todos = latestTodos([...turn]);
	if (todos.length > 0)
		return todos.map((todo, index) => ({
			key: `todo-${index}`,
			state: TODO_STATES[todo.status],
			kind: "todo",
			text: todo.status === "in_progress" ? todo.activeForm : todo.content,
		}));
	return turn.filter(isToolCall).map((tool) => ({
		key: tool.id,
		state: toolState(tool, isRunning),
		kind: "tool",
		tool: describeTool(tool.toolName, tool.args),
	}));
}

function pageOf(tool: ToolCallMessage): string | null {
	if (!bareToolName(tool.toolName).startsWith("builder_")) return null;
	const { args } = tool;
	if (args === null || typeof args !== "object") return null;
	for (const key of PAGE_ARGS) {
		if (!Object.hasOwn(args, key)) continue;
		const value: unknown = Reflect.get(args, key);
		if (typeof value !== "string" || !value.startsWith(PAGE_PATH_PREFIX))
			continue;
		return value.split(PAGE_SEPARATOR)[0];
	}
	return null;
}

/** The build dialog's view of the turn that builds `mockup`. */
export function buildView(
	mockup: string,
	messages: readonly ConversationMessage[],
	isRunning: boolean,
): BuildView {
	const turn = sinceLastRequest(messages);
	const previews = turn.filter(
		(message): message is BlockPreviewMessage =>
			message.role === MESSAGE_ROLES.BLOCK_PREVIEW,
	);
	const pages = turn
		.filter(isToolCall)
		.map(pageOf)
		.filter((page) => page !== null);
	const comparison = previews.at(-1) ?? null;
	return {
		mockup,
		steps: stepsOf(turn, isRunning),
		comparison,
		reference:
			comparison === null
				? null
				: referenceView(comparison.preview.reference, messages),
		outcome: outcomeOf(turn, isRunning),
		pagePath: pages.at(-1) ?? null,
	};
}
