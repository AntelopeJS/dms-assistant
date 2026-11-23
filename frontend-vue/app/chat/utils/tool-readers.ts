import type { JsonObject } from "../types/json";
import { ownMember, toJsonObject, toTextOrNumber } from "./json";

export const MCP_PREFIX = /^mcp__[^_]+(?:_[^_]+)*?__/;
const TARGET_SEPARATOR = " · ";
const PATH_SEPARATOR = "/";

/** Where a tool's target comes from in its arguments. */
export type TargetReader = (args: JsonObject) => string;

export interface ToolLexiconEntry {
	/** Key under `dms_assistant.tools.*`. */
	verb: string;
	icon: string;
	target: TargetReader;
	/** Reads only: never changes the project. */
	isReadOnly?: boolean;
}

function readString(args: JsonObject, key: string): string {
	return toTextOrNumber(ownMember(args, key))?.trim() ?? "";
}

export function firstOf(...keys: string[]): TargetReader {
	return (args) =>
		keys.map((key) => readString(args, key)).find((v) => v !== "") ?? "";
}

function baseName(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	return trimmed.split(PATH_SEPARATOR).at(-1) ?? trimmed;
}

export function fileOf(...keys: string[]): TargetReader {
	const read = firstOf(...keys);
	return (args) => baseName(read(args));
}

export function quoted(...keys: string[]): TargetReader {
	const read = firstOf(...keys);
	return (args) => {
		const value = read(args);
		return value === "" ? "" : `“${value}”`;
	};
}

export function joined(...readers: TargetReader[]): TargetReader {
	return (args) =>
		readers
			.map((read) => read(args))
			.filter((part) => part !== "")
			.join(TARGET_SEPARATOR);
}

export function hostOf(key: string): TargetReader {
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

export function countOf(key: string): TargetReader {
	return (args) => {
		const value = ownMember(args, key);
		return Array.isArray(value) ? String(value.length) : "";
	};
}

export function nested(key: string, inner: string): TargetReader {
	return (args) => readString(toJsonObject(ownMember(args, key)), inner);
}

export const none: TargetReader = () => "";

const TOOL_QUERY_PREFIX = /^select:/;
const TOOL_LIST_SEPARATOR = ",";

/** "select:mcp__dms-assistant__list_pages,…" → "list_pages, …". */
export const toolQuery: TargetReader = (args) =>
	readString(args, "query")
		.replace(TOOL_QUERY_PREFIX, "")
		.split(TOOL_LIST_SEPARATOR)
		.map((name) => name.trim().replace(MCP_PREFIX, ""))
		.join(", ");

export const ICONS = {
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
} as const;
