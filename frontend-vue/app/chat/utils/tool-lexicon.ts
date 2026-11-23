/**
 * @fileoverview The chat's tool lexicon: every tool the agents call (Claude
 * built-ins, the Codex items the sidecar maps onto them, dms-assistant's MCP
 * tools and the Builder's) as a translated verb, an icon and a target read
 * from its arguments, so a row reads "Add block · Top customers · TopListCard"
 * rather than a tool name and a JSON blob.
 */
import type { JsonValue } from "../types/json";
import { toJsonObject, toText } from "./json";
import { CLAUDE_TOOLS } from "./tool-claude";
import { ASSISTANT_TOOLS, BUILDER_TOOLS, DMS_TOOLS } from "./tool-dms";
import { firstOf, MCP_PREFIX, type ToolLexiconEntry } from "./tool-readers";

const WORD_BOUNDARY = /([a-z0-9])([A-Z])/g;
const SEPARATORS = /[_\s-]+/g;
const MAX_TARGET_CHARS = 72;
const ELLIPSIS = "…";
const DEFAULT_ICON = "i-ph-wrench";

export interface ToolDescription {
	/** Translation key of the verb, or null for a tool the lexicon lacks. */
	verbKey: string | null;
	/** Readable form of the raw name, used when `verbKey` is null. */
	fallbackVerb: string;
	icon: string;
	target: string;
	isReadOnly: boolean;
}

const LEXICON: ReadonlyMap<string, ToolLexiconEntry> = new Map(
	Object.entries({
		...CLAUDE_TOOLS,
		...ASSISTANT_TOOLS,
		...BUILDER_TOOLS,
		...DMS_TOOLS,
	}),
);

/** Every verb key the lexicon uses, so the locale files can be checked. */
export const TOOL_VERB_KEYS: readonly string[] = [
	...new Set([...LEXICON.values()].map((entry) => entry.verb)),
];

/** The tool's own name, without the `mcp__<server>__` an MCP tool carries. */
export function bareToolName(toolName: string): string {
	return toolName.replace(MCP_PREFIX, "");
}

/** "builder_add_block" → "Builder add block", for a tool the lexicon lacks. */
export function readableToolName(toolName: string): string {
	const words = bareToolName(toolName)
		.replace(WORD_BOUNDARY, "$1 $2")
		.replace(SEPARATORS, " ")
		.trim()
		.toLowerCase();
	if (words === "") return toolName;
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function shorten(value: string): string {
	const oneLine = value.replace(/\s+/g, " ").trim();
	if (oneLine.length <= MAX_TARGET_CHARS) return oneLine;
	return `${oneLine.slice(0, MAX_TARGET_CHARS - ELLIPSIS.length)}${ELLIPSIS}`;
}

const GENERIC_TARGET = firstOf(
	"file_path",
	"path",
	"pageRef",
	"ref",
	"name",
	"command",
	"url",
	"query",
	"pattern",
);

/** What a call does and to what, in the lexicon's words. */
export function describeTool(
	toolName: string,
	args: JsonValue | undefined,
): ToolDescription {
	const entry = LEXICON.get(bareToolName(toolName));
	const record = toJsonObject(args);
	const target = shorten((entry?.target ?? GENERIC_TARGET)(record));
	return {
		verbKey: entry?.verb ?? null,
		fallbackVerb: readableToolName(toolName),
		icon: entry?.icon ?? DEFAULT_ICON,
		target,
		isReadOnly: entry?.isReadOnly === true,
	};
}

/** The verb of a call, translated, or the readable name of an unknown tool. */
export function toolVerb(
	description: ToolDescription,
	translate: (key: string) => string,
): string {
	if (description.verbKey === null) return description.fallbackVerb;
	return translate(`dms_assistant.tools.${description.verbKey}`);
}

/** One argument of a call, as the expanded row lists it. */
export interface NamedArgument {
	name: string;
	value: string;
}

const MAX_ARGUMENT_CHARS = 240;

function formatArgument(value: JsonValue): string {
	return toText(value) ?? JSON.stringify(value);
}

/** The call's arguments by name, each value on one readable line. */
export function namedArguments(args: JsonValue | undefined): NamedArgument[] {
	return Object.entries(toJsonObject(args)).map(([name, value]) => {
		const text = formatArgument(value);
		return {
			name,
			value:
				text.length > MAX_ARGUMENT_CHARS
					? `${text.slice(0, MAX_ARGUMENT_CHARS - ELLIPSIS.length)}${ELLIPSIS}`
					: text,
		};
	});
}
