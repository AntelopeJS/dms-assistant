/**
 * @fileoverview The chat's tool lexicon: every tool the agents call (Claude
 * built-ins, the Codex items the sidecar maps onto them, dms-assistant's MCP
 * tools and the Builder's) as a translated verb, an icon and a target read
 * from its arguments, so a row reads "Add block · Top customers · TopListCard"
 * rather than a tool name and a JSON blob.
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../types/json";

const MCP_PREFIX = /^mcp__[^_]+(?:_[^_]+)*?__/;
const WORD_BOUNDARY = /([a-z0-9])([A-Z])/g;
const SEPARATORS = /[_\s-]+/g;
const MAX_TARGET_CHARS = 72;
const ELLIPSIS = "…";
const TARGET_SEPARATOR = " · ";
const PATH_SEPARATOR = "/";
const DEFAULT_ICON = "i-ph-wrench";

/** Where a tool's target comes from in its arguments. */
type TargetReader = (args: JsonObject) => string;

interface ToolLexiconEntry {
	/** Key under `dms_assistant.tools.*`. */
	verb: string;
	icon: string;
	target: TargetReader;
	/** Reads only: never changes the project. */
	isReadOnly?: boolean;
}

export interface ToolDescription {
	/** Translation key of the verb, or null for a tool the lexicon lacks. */
	verbKey: string | null;
	/** Readable form of the raw name, used when `verbKey` is null. */
	fallbackVerb: string;
	icon: string;
	target: string;
	isReadOnly: boolean;
}

const ARGUMENTS_SCHEMA: z.ZodType<JsonObject> = z.record(z.string(), z.json());
const TEXT_SCHEMA = z.string();
const TEXT_OR_NUMBER_SCHEMA = z.union([z.string(), z.number()]);

/** The arguments a call carries: an empty set when they are not an object. */
function argumentsOf(value: JsonValue | undefined): JsonObject {
	const parsed = ARGUMENTS_SCHEMA.safeParse(value);
	return parsed.success ? parsed.data : {};
}

/** An argument of its own, never one the object inherits. */
function memberOf(args: JsonObject, key: string): JsonValue | undefined {
	return Object.hasOwn(args, key) ? args[key] : undefined;
}

function textOf(value: JsonValue | undefined): string | null {
	const parsed = TEXT_SCHEMA.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function readString(args: JsonObject, key: string): string {
	const parsed = TEXT_OR_NUMBER_SCHEMA.safeParse(memberOf(args, key));
	return parsed.success ? String(parsed.data).trim() : "";
}

function firstOf(...keys: string[]): TargetReader {
	return (args) =>
		keys.map((key) => readString(args, key)).find((v) => v !== "") ?? "";
}

function baseName(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	return trimmed.split(PATH_SEPARATOR).at(-1) ?? trimmed;
}

function fileOf(...keys: string[]): TargetReader {
	const read = firstOf(...keys);
	return (args) => baseName(read(args));
}

function quoted(...keys: string[]): TargetReader {
	const read = firstOf(...keys);
	return (args) => {
		const value = read(args);
		return value === "" ? "" : `“${value}”`;
	};
}

function joined(...readers: TargetReader[]): TargetReader {
	return (args) =>
		readers
			.map((read) => read(args))
			.filter((part) => part !== "")
			.join(TARGET_SEPARATOR);
}

function hostOf(key: string): TargetReader {
	return (args) => {
		const url = readString(args, key);
		try {
			const parsed = new URL(url);
			return `${parsed.host}${parsed.pathname === PATH_SEPARATOR ? "" : parsed.pathname}`;
		} catch {
			return url;
		}
	};
}

function countOf(key: string): TargetReader {
	return (args) => {
		const value = memberOf(args, key);
		return Array.isArray(value) ? String(value.length) : "";
	};
}

function nested(key: string, inner: string): TargetReader {
	return (args) => readString(argumentsOf(memberOf(args, key)), inner);
}

const none: TargetReader = () => "";

const TOOL_QUERY_PREFIX = /^select:/;
const TOOL_LIST_SEPARATOR = ",";

/** "select:mcp__dms-assistant__list_pages,…" → "list_pages, …". */
const toolQuery: TargetReader = (args) =>
	readString(args, "query")
		.replace(TOOL_QUERY_PREFIX, "")
		.split(TOOL_LIST_SEPARATOR)
		.map((name) => name.trim().replace(MCP_PREFIX, ""))
		.join(", ");

const ICONS = {
	READ: "i-ph-file-text",
	EDIT: "i-ph-pencil-simple-line",
	COMMAND: "i-ph-terminal-window",
	SEARCH: "i-ph-magnifying-glass",
	FOLDER: "i-ph-folder-simple",
	WEB: "i-ph-globe",
	STEPS: "i-ph-list-checks",
	DELEGATE: "i-ph-robot",
	ASK: "i-ph-question",
	PAGE: "i-ph-tree-structure",
	BLOCK: "i-ph-squares-four",
	DATA: "i-ph-database",
	CHECK: "i-ph-shield-check",
	OPEN: "i-ph-arrow-square-out",
	BROWSER: "i-ph-browser",
	CREATE_PAGE: "i-ph-folder-simple-plus",
	DELETE: "i-ph-trash",
	TABLE: "i-ph-table",
	FIELD: "i-ph-textbox",
	LOGS: "i-ph-scroll",
	SKILL: "i-ph-books",
	PLAN: "i-ph-list-checks",
	REFRESH: "i-ph-arrows-clockwise",
	CATEGORY: "i-ph-folders",
	ARTIFACT: "i-ph-presentation-chart",
} as const;

/** A tool that only reads: it never changes the project. */
function readOnly(
	verb: string,
	icon: string,
	target: TargetReader,
): ToolLexiconEntry {
	return { verb, icon, target, isReadOnly: true };
}

/** A tool that changes the project, or may. */
function changing(
	verb: string,
	icon: string,
	target: TargetReader,
): ToolLexiconEntry {
	return { verb, icon, target };
}

const CLAUDE_TOOLS = {
	Read: readOnly("read_file", ICONS.READ, fileOf("file_path")),
	Write: changing("write_file", ICONS.EDIT, fileOf("file_path")),
	Edit: changing("edit_file", ICONS.EDIT, fileOf("file_path")),
	MultiEdit: changing("edit_file", ICONS.EDIT, fileOf("file_path")),
	NotebookEdit: changing("edit_notebook", ICONS.EDIT, fileOf("notebook_path")),
	Bash: changing("run_command", ICONS.COMMAND, firstOf("command")),
	BashOutput: readOnly("read_output", ICONS.COMMAND, firstOf("bash_id")),
	KillShell: changing("stop_command", ICONS.COMMAND, firstOf("shell_id")),
	KillBash: changing("stop_command", ICONS.COMMAND, firstOf("shell_id")),
	Glob: readOnly("find_files", ICONS.SEARCH, firstOf("pattern")),
	Grep: readOnly("search_code", ICONS.SEARCH, quoted("pattern")),
	LS: readOnly("list_folder", ICONS.FOLDER, firstOf("path")),
	WebFetch: changing("fetch_url", ICONS.WEB, hostOf("url")),
	WebSearch: readOnly("search_web", ICONS.WEB, quoted("query")),
	TodoWrite: readOnly("update_steps", ICONS.STEPS, countOf("todos")),
	Task: changing("delegate", ICONS.DELEGATE, firstOf("description")),
	Agent: changing("delegate", ICONS.DELEGATE, firstOf("description")),
	ExitPlanMode: readOnly("propose_plan", ICONS.PLAN, none),
	AskUserQuestion: readOnly("ask_you", ICONS.ASK, countOf("questions")),
	Skill: readOnly("use_skill", ICONS.SKILL, firstOf("skill", "command")),
	SlashCommand: changing("run_slash_command", ICONS.SKILL, firstOf("command")),
	ToolSearch: readOnly("search_tools", ICONS.SEARCH, toolQuery),
};

const ASSISTANT_TOOLS = {
	get_current_page: readOnly("read_current_page", ICONS.BROWSER, none),
	navigate_to_page: readOnly("open_page", ICONS.OPEN, firstOf("path")),
	find_pages_using: readOnly(
		"find_pages",
		ICONS.SEARCH,
		firstOf("component", "query", "name"),
	),
	list_pages: readOnly("list_pages", ICONS.PAGE, none),
	ask_user: readOnly("ask_you", ICONS.ASK, countOf("questions")),
	create_artifact: readOnly(
		"create_artifact",
		ICONS.ARTIFACT,
		firstOf("title"),
	),
	typecheck: readOnly("typecheck", ICONS.CHECK, none),
	query_logs: readOnly(
		"read_logs",
		ICONS.LOGS,
		firstOf("query", "search", "level"),
	),
	database_connections: readOnly("list_databases", ICONS.DATA, none),
	database_relations: readOnly(
		"list_relations",
		ICONS.DATA,
		firstOf("connection"),
	),
	database_describe: readOnly(
		"describe_relations",
		ICONS.TABLE,
		countOf("relations"),
	),
	database_project: readOnly(
		"read_database_setup",
		ICONS.DATA,
		firstOf("connection", "engine"),
	),
	mockup_read_spec: readOnly("read_mockup", ICONS.PAGE, firstOf("mockup")),
	database_profile: readOnly(
		"profile_relation",
		ICONS.TABLE,
		firstOf("relation", "connection"),
	),
};

const BUILDER_TOOLS = {
	builder_catalog: readOnly("browse_blocks", ICONS.BLOCK, none),
	builder_list_pages: readOnly("list_pages", ICONS.PAGE, none),
	builder_page_structure: readOnly("read_page", ICONS.PAGE, firstOf("pageRef")),
	builder_create_page: changing(
		"create_page",
		ICONS.CREATE_PAGE,
		firstOf("displayName", "name"),
	),
	builder_configure_page: changing(
		"configure_page",
		ICONS.PAGE,
		firstOf("pageRef"),
	),
	builder_delete_page: changing(
		"delete_page",
		ICONS.DELETE,
		firstOf("pageRef"),
	),
	builder_add_block: changing(
		"add_block",
		ICONS.BLOCK,
		joined(firstOf("name"), firstOf("type")),
	),
	builder_configure_block: changing(
		"configure_block",
		ICONS.BLOCK,
		firstOf("path"),
	),
	builder_compose_page: changing(
		"compose_page",
		ICONS.BLOCK,
		firstOf("pageRef"),
	),
	builder_configure_table_view: changing(
		"configure_table_view",
		ICONS.BLOCK,
		firstOf("pageRef"),
	),
	builder_move_block: changing("move_block", ICONS.BLOCK, firstOf("path")),
	builder_remove_block: changing("remove_block", ICONS.BLOCK, firstOf("path")),
	builder_create_category: changing(
		"create_category",
		ICONS.CATEGORY,
		firstOf("displayName", "name"),
	),
	builder_configure_category: changing(
		"configure_category",
		ICONS.CATEGORY,
		firstOf("ref"),
	),
	builder_delete_category: changing(
		"delete_category",
		ICONS.DELETE,
		firstOf("ref"),
	),
	builder_refresh: readOnly(
		"refresh_builder",
		ICONS.REFRESH,
		firstOf("pageRef"),
	),
	builder_list_resources: readOnly("list_tables", ICONS.TABLE, none),
	builder_resource_structure: readOnly(
		"read_table",
		ICONS.TABLE,
		firstOf("ref"),
	),
	builder_configure_project: changing("configure_project", ICONS.DATA, none),
	builder_map_resources: changing(
		"map_tables",
		ICONS.TABLE,
		firstOf("connection", "module"),
	),
	builder_mapping: readOnly(
		"read_mapping",
		ICONS.TABLE,
		firstOf("connection", "module"),
	),
	builder_analyse_database: readOnly(
		"analyse_database",
		ICONS.TABLE,
		firstOf("connection", "job"),
	),
	builder_create_resource: changing(
		"create_table",
		ICONS.TABLE,
		firstOf("displayName", "name"),
	),
	builder_delete_resource: changing(
		"delete_table",
		ICONS.DELETE,
		firstOf("ref"),
	),
	builder_add_field: changing(
		"add_field",
		ICONS.FIELD,
		joined(firstOf("ref"), nested("field", "name")),
	),
	builder_configure_field: changing(
		"configure_field",
		ICONS.FIELD,
		firstOf("path"),
	),
	builder_configure_column_groups: changing(
		"configure_column_groups",
		ICONS.FIELD,
		firstOf("resource"),
	),
	mockup_apply_to_page: changing(
		"apply_mockup",
		ICONS.PAGE,
		firstOf("mockup", "page"),
	),
	builder_remove_field: changing("remove_field", ICONS.FIELD, firstOf("path")),
	builder_query_templates: readOnly(
		"browse_queries",
		ICONS.DATA,
		firstOf("resourceType"),
	),
	builder_add_query: changing("add_query", ICONS.DATA, firstOf("name")),
	builder_preview_query: readOnly("preview_query", ICONS.DATA, firstOf("name")),
	builder_configure_query: changing(
		"configure_query",
		ICONS.DATA,
		firstOf("path", "name"),
	),
	builder_remove_query: changing(
		"remove_query",
		ICONS.DATA,
		firstOf("path", "name"),
	),
};

/** Tools of the DMS's own development MCP server. */
const DMS_TOOLS = {
	page_verify: readOnly("verify_page", ICONS.CHECK, firstOf("page")),
};

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
	const target = shorten((entry?.target ?? GENERIC_TARGET)(argumentsOf(args)));
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
	return textOf(value) ?? JSON.stringify(value);
}

/** The call's arguments by name, each value on one readable line. */
export function namedArguments(args: JsonValue | undefined): NamedArgument[] {
	return Object.entries(argumentsOf(args)).map(([name, value]) => {
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
