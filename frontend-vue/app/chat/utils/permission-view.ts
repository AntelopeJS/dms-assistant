import type { PermissionRequestData } from "../types/permission";
import type { Translate } from "../composables/useChatI18n";
import type { JsonValue } from "../types/json";
import type {
	CommandPreview,
	DestructivePreview,
	DiffPreview,
	HeldPreview,
	PermissionKind,
	PermissionRule,
	RuleKind,
	WebPreview,
} from "../types/protocol";
import { ownMember, toJsonObject, toText } from "./json";
import {
	bareToolName,
	describeTool,
	type NamedArgument,
	toolVerb,
} from "./tool-lexicon";

/** How a card names its request, in the user's language. */
export interface PermissionCardText {
	title: string;
	sub: string;
	/** "Only this edit", "Only this command"… */
	onceLabel: string;
	allowLabel: string;
	/** Why the request asks even where most do not; empty when it needs no word. */
	why: string;
}

const PATH_SEPARATOR = "/";

function baseName(path: string): string {
	return path.split(PATH_SEPARATOR).filter(Boolean).at(-1) ?? path;
}

function verbAndTarget(req: PermissionRequestData, t: Translate): string {
	const description = describeTool(req.toolName, req.args);
	const verb = toolVerb(description, t);
	return description.target === "" ? verb : `${verb} ${description.target}`;
}

function diffText(preview: DiffPreview, t: Translate): PermissionCardText {
	return {
		title: t(
			preview.isNewFile
				? "dms_assistant.panel.approvals.create_file"
				: "dms_assistant.panel.approvals.edit_file",
			{ file: baseName(preview.relativePath || preview.path) },
		),
		sub: preview.relativePath || preview.path,
		onceLabel: t("dms_assistant.panel.approvals.once_edit"),
		allowLabel: t("dms_assistant.panel.approvals.allow_edit"),
		why: "",
	};
}

function commandText(
	preview: CommandPreview,
	t: Translate,
): PermissionCardText {
	return {
		title: t("dms_assistant.panel.approvals.run", { command: preview.command }),
		sub: commandSub(preview, t),
		onceLabel: t("dms_assistant.panel.approvals.once_command"),
		allowLabel: t("dms_assistant.panel.approvals.allow_command"),
		why: "",
	};
}

function destructiveText(
	req: PermissionRequestData,
	preview: DestructivePreview,
	t: Translate,
): PermissionCardText {
	return {
		title: destructiveTitle(req, preview, t),
		sub: t(`dms_assistant.panel.approvals.consequence_${preview.consequence}`),
		onceLabel: t("dms_assistant.panel.approvals.once_time"),
		allowLabel: t("dms_assistant.panel.approvals.confirm_delete"),
		why: t(`dms_assistant.panel.approvals.why_${preview.consequence}`),
	};
}

function webText(preview: WebPreview, t: Translate): PermissionCardText {
	return {
		title: t("dms_assistant.panel.approvals.fetch", { host: preview.host }),
		sub: preview.url,
		onceLabel: t("dms_assistant.panel.approvals.once_request"),
		allowLabel: t("dms_assistant.panel.approvals.allow_request"),
		why: "",
	};
}

function genericText(
	req: PermissionRequestData,
	t: Translate,
): PermissionCardText {
	return {
		title: verbAndTarget(req, t),
		sub: "",
		onceLabel: t("dms_assistant.panel.approvals.once_time"),
		allowLabel: t("dms_assistant.panel.approvals.allow"),
		why:
			req.kind === "builder"
				? t("dms_assistant.panel.approvals.why_builder")
				: "",
	};
}

function heldText(
	req: PermissionRequestData,
	preview: HeldPreview,
	t: Translate,
): PermissionCardText {
	return {
		title: verbAndTarget(req, t),
		sub: "",
		onceLabel: t("dms_assistant.panel.approvals.once_time"),
		allowLabel: t("dms_assistant.panel.approvals.allow"),
		why: heldWhy(preview, t),
	};
}

function heldToolText(
	req: PermissionRequestData,
	t: Translate,
): PermissionCardText {
	return {
		title: verbAndTarget(req, t),
		sub: "",
		onceLabel: t("dms_assistant.panel.approvals.once_time"),
		allowLabel: t("dms_assistant.panel.approvals.allow"),
		why: t("dms_assistant.panel.approvals.why_held_tool"),
	};
}

const CONFIGURE_PROJECT_TOOL_NAME = "builder_configure_project";
const MAP_RESOURCES_TOOL_NAME = "builder_map_resources";

function pagesToRemove(details: JsonValue): string[] {
	const pages = ownMember(toJsonObject(details), "pagesToRemove");
	if (!Array.isArray(pages)) return [];
	return pages.flatMap((page) => toText(page) ?? []);
}

function heldWhy(preview: HeldPreview, t: Translate): string {
	if (preview.operation === CONFIGURE_PROJECT_TOOL_NAME)
		return t("dms_assistant.panel.approvals.why_held_configure");
	const pages = pagesToRemove(preview.details);
	if (preview.operation === MAP_RESOURCES_TOOL_NAME && pages.length > 0)
		return t("dms_assistant.panel.approvals.why_held_map", {
			pages: pages.join(", "),
		});
	return t("dms_assistant.panel.approvals.why_held");
}

/**
 * Every value of a held call's preview on a row of its own, in full: nested
 * keys joined by dots, list items by index, text such as a diff as it is.
 */
export function heldPreviewRows(
	details: JsonValue,
	name = "",
): NamedArgument[] {
	if (Array.isArray(details) && details.length > 0)
		return details.flatMap((item, index) =>
			heldPreviewRows(item, `${name}[${index}]`),
		);
	const entries = Object.entries(toJsonObject(details));
	if (entries.length > 0)
		return entries.flatMap(([key, value]) =>
			heldPreviewRows(value, name === "" ? key : `${name}.${key}`),
		);
	return [{ name, value: toText(details) ?? JSON.stringify(details) }];
}

const MAX_SIDE_BY_SIDE_NAME_CHARS = 16;
const MAX_SIDE_BY_SIDE_VALUE_CHARS = 24;

/**
 * Whether a row reads on the card's whole width, its value under its name:
 * a value of several lines, such as a diff, or a name or value too long to
 * share a narrow panel's width with the other.
 */
export function isStackedRow(row: NamedArgument): boolean {
	return (
		row.value.includes("\n") ||
		row.value.length > MAX_SIDE_BY_SIDE_VALUE_CHARS ||
		row.name.length > MAX_SIDE_BY_SIDE_NAME_CHARS
	);
}

/** "Delete the page {target}": the Builder's destructive operations by name. */
const DESTRUCTIVE_TITLE_KEYS: ReadonlyMap<string, string> = new Map([
	[
		"builder_delete_page",
		"dms_assistant.panel.approvals.destructive.delete_page",
	],
	[
		"builder_delete_resource",
		"dms_assistant.panel.approvals.destructive.delete_table",
	],
	[
		"builder_remove_field",
		"dms_assistant.panel.approvals.destructive.remove_field",
	],
	[
		"builder_delete_category",
		"dms_assistant.panel.approvals.destructive.delete_category",
	],
	[
		"builder_remove_query",
		"dms_assistant.panel.approvals.destructive.remove_query",
	],
	[
		"builder_map_resources",
		"dms_assistant.panel.approvals.destructive.map_resources",
	],
]);

function destructiveTitle(
	req: PermissionRequestData,
	preview: DestructivePreview,
	t: Translate,
): string {
	const operation = bareToolName(preview.operation || req.toolName);
	const key = DESTRUCTIVE_TITLE_KEYS.get(operation);
	if (key !== undefined) return t(key, { target: preview.target });
	const verb = toolVerb(describeTool(operation, req.args), t);
	return preview.target === "" ? verb : `${verb} ${preview.target}`;
}

function commandSub(preview: CommandPreview, t: Translate): string {
	const touches = (preview.touches ?? []).join(", ");
	if (preview.effect === undefined) return touches || preview.cwd;
	const effect = t(`dms_assistant.panel.approvals.effect_${preview.effect}`);
	return touches === "" ? effect : `${effect} · ${touches}`;
}

/** The words of a permission card, read from its preview. */
export function permissionCardText(
	req: PermissionRequestData,
	t: Translate,
): PermissionCardText {
	const preview = req.preview;
	switch (preview.type) {
		case "diff":
			return diffText(preview, t);
		case "command":
			return commandText(preview, t);
		case "destructive":
			return destructiveText(req, preview, t);
		case "web":
			return webText(preview, t);
		case "held":
			return heldText(req, preview, t);
		case "held_tool":
			return heldToolText(req, t);
		default:
			return genericText(req, t);
	}
}

const RULE_LABEL_KEYS: Record<RuleKind, string> = {
	file: "dms_assistant.panel.approvals.rule_file",
	directory: "dms_assistant.panel.approvals.rule_directory",
	command: "dms_assistant.panel.approvals.rule_command",
	domain: "dms_assistant.panel.approvals.rule_domain",
};

/** A scope as the card offers it: "Every edit under crm/customers/". */
export function ruleLabelKey(rule: PermissionRule): string {
	return RULE_LABEL_KEYS[rule.kind];
}

const RULE_ICONS: Record<RuleKind, string> = {
	file: "i-ph-pencil-simple-line",
	directory: "i-ph-folder-simple",
	command: "i-ph-terminal-window",
	domain: "i-ph-globe",
};

export function ruleIcon(kind: RuleKind): string {
	return RULE_ICONS[kind] ?? "i-ph-key";
}

const KIND_ICONS: Record<PermissionKind, string> = {
	edit: "i-ph-pencil-simple-line",
	command: "i-ph-terminal-window",
	web: "i-ph-globe",
	destructive: "i-ph-trash",
	builder: "i-ph-squares-four",
	other: "i-ph-hand-palm",
};

/** The card's icon: by kind, else the tool's own. */
export function permissionIcon(req: PermissionRequestData): string {
	if (req.kind === "other") return describeTool(req.toolName, req.args).icon;
	return KIND_ICONS[req.kind];
}
