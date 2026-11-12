import { MESSAGE_ROLES } from "../constants/conversation";
import type {
	ConversationMessage,
	ToolCallMessage,
} from "../types/conversation";
import { bareToolName } from "./tool-lexicon";

const PAGE_SEPARATOR = "#";

function readStringField(args: unknown, key: string): string | null {
	if (args === null || typeof args !== "object" || !Object.hasOwn(args, key))
		return null;
	const value: unknown = Reflect.get(args, key);
	return typeof value === "string" && value !== "" ? value : null;
}
const BUILDER_SEPARATOR = "/";
const LAYOUT_SEPARATOR = ".";

/** The argument naming the block a Builder tool changes, in Builder path form. */
const BLOCK_PATH_ARGS: ReadonlyMap<string, string> = new Map([
	["builder_configure_block", "path"],
	["builder_move_block", "path"],
	["builder_remove_block", "path"],
	["builder_add_block", "parent"],
]);

/** The argument naming a top-level block by its name alone. */
const BLOCK_NAME_ARGS: ReadonlyMap<string, string> = new Map([
	["builder_configure_table_view", "block"],
]);

/**
 * The layout path a page draws on a block's root element (`data-dms-block`)
 * from the Builder's path of that block: `/dashboard#grid/kpi` is `grid.kpi`.
 */
export function layoutPathOf(builderPath: string): string | null {
	const separator = builderPath.indexOf(PAGE_SEPARATOR);
	if (separator < 0) return null;
	const blocks = builderPath
		.slice(separator + PAGE_SEPARATOR.length)
		.split(BUILDER_SEPARATOR)
		.filter((segment) => segment !== "");
	return blocks.length === 0 ? null : blocks.join(LAYOUT_SEPARATOR);
}

/** The layout path of the block a Builder tool call changes, `null` for any other call. */
export function blockTargetOf(tool: ToolCallMessage): string | null {
	const name = bareToolName(tool.toolName);
	const pathArg = BLOCK_PATH_ARGS.get(name);
	if (pathArg !== undefined) {
		const path = readStringField(tool.args, pathArg);
		return path === null ? null : layoutPathOf(path);
	}
	const nameArg = BLOCK_NAME_ARGS.get(name);
	return nameArg === undefined ? null : readStringField(tool.args, nameArg);
}

function isToolCall(message: ConversationMessage): message is ToolCallMessage {
	return message.role === MESSAGE_ROLES.TOOL;
}

/**
 * The block the running turn is changing: the target of its latest Builder
 * call that names one. `null` once the turn ends.
 */
export function changingBlock(
	messages: readonly ConversationMessage[],
	isRunning: boolean,
): string | null {
	if (!isRunning) return null;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === MESSAGE_ROLES.USER) return null;
		if (!isToolCall(message)) continue;
		const target = blockTargetOf(message);
		if (target !== null) return target;
	}
	return null;
}
