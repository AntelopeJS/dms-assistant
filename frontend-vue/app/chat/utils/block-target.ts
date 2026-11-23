import { MESSAGE_ROLES } from "../constants/conversation";
import type { JsonValue } from "../types/json";
import type {
	ConversationMessage,
	ToolCallMessage,
} from "../types/conversation";
import { ownMember, toJsonObject, toText } from "./json";
import { bareToolName } from "./tool-lexicon";

const PAGE_SEPARATOR = "#";
const BUILDER_SEPARATOR = "/";
const LAYOUT_SEPARATOR = ".";
const TRAILING_SLASHES = /\/+$/;

function readStringField(
	args: JsonValue | undefined,
	key: string,
): string | null {
	const value = toText(ownMember(toJsonObject(args), key));
	return value !== null && value !== "" ? value : null;
}

/** A block of one page: the page's path and the block's layout path on it. */
export interface BlockTarget {
	page: string;
	layoutPath: string;
}

/** The argument naming the block a Builder tool changes, in Builder path form. */
const BLOCK_PATH_ARGS: ReadonlyMap<string, string> = new Map([
	["builder_configure_block", "path"],
	["builder_move_block", "path"],
	["builder_remove_block", "path"],
	["builder_add_block", "parent"],
]);

/** The arguments naming a top-level block by its page and its name alone. */
const BLOCK_NAME_ARGS: ReadonlyMap<string, { page: string; block: string }> =
	new Map([
		["builder_configure_table_view", { page: "pageRef", block: "block" }],
	]);

function pagePathOf(pageRef: string): string {
	const trimmed = pageRef.replace(TRAILING_SLASHES, "");
	return trimmed === "" ? BUILDER_SEPARATOR : trimmed;
}

/**
 * The block a Builder path names, with the layout path its page draws on the
 * block's root element (`data-dms-block`): `/dashboard#grid/kpi` is `grid.kpi`
 * on `/dashboard`.
 */
export function blockTargetFromPath(builderPath: string): BlockTarget | null {
	const separator = builderPath.indexOf(PAGE_SEPARATOR);
	if (separator < 0) return null;
	const blocks = builderPath
		.slice(separator + PAGE_SEPARATOR.length)
		.split(BUILDER_SEPARATOR)
		.filter((segment) => segment !== "");
	if (blocks.length === 0) return null;
	return {
		page: pagePathOf(builderPath.slice(0, separator)),
		layoutPath: blocks.join(LAYOUT_SEPARATOR),
	};
}

/** The block a Builder tool call changes, `null` for any other call. */
export function blockTargetOf(tool: ToolCallMessage): BlockTarget | null {
	const name = bareToolName(tool.toolName);
	const pathArg = BLOCK_PATH_ARGS.get(name);
	if (pathArg !== undefined) {
		const path = readStringField(tool.args, pathArg);
		return path === null ? null : blockTargetFromPath(path);
	}
	const named = BLOCK_NAME_ARGS.get(name);
	if (named === undefined) return null;
	const page = readStringField(tool.args, named.page);
	const block = readStringField(tool.args, named.block);
	return page === null || block === null
		? null
		: { page: pagePathOf(page), layoutPath: block };
}

function isToolCall(message: ConversationMessage): message is ToolCallMessage {
	return message.role === MESSAGE_ROLES.TOOL;
}

/**
 * The layout path of the block the running turn is changing on the page on
 * screen: the target of its latest Builder call that names one. `null` once
 * the turn ends, and when that block is on another page.
 */
export function changingBlock(
	messages: readonly ConversationMessage[],
	isRunning: boolean,
	pagePath: string | null,
): string | null {
	if (!isRunning || pagePath === null) return null;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === MESSAGE_ROLES.USER) return null;
		if (!isToolCall(message)) continue;
		const target = blockTargetOf(message);
		if (target === null) continue;
		return target.page === pagePathOf(pagePath) ? target.layoutPath : null;
	}
	return null;
}
