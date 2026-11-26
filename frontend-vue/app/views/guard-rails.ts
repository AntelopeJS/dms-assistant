import { modesFor } from "../chat/constants/modes";
import type { ProviderName } from "../chat/types/protocol";
import type { ApprovalMode } from "./types";

/**
 * What `GET /ai/settings` answers for the guard rails: the default approval
 * modes, the Safe mode switch, the asks and local skills, with the Builder
 * capability Safe mode needs.
 */
export interface GuardRailValues {
	defaultModeClaude: ApprovalMode;
	defaultModeCodex: ApprovalMode;
	safeMode: boolean;
	alwaysAskDeletions: boolean;
	alwaysAskDependencies: boolean;
	alwaysAskBlockRemoval: boolean;
	allowLocalSkills: boolean;
	builderAvailable?: boolean;
}

/** One provider's default approval mode, saved on its own. */
export interface ModeRow {
	field: "defaultModeClaude" | "defaultModeCodex";
	/** The modes this provider offers. */
	modes: readonly ApprovalMode[];
	/** The `$dms_assistant.settings` group holding the row's label and description. */
	text: string;
	provider: ProviderName;
}

export const MODE_ROWS: readonly ModeRow[] = [
	{
		field: "defaultModeClaude",
		modes: modesFor("claude"),
		text: "default_mode_claude",
		provider: "claude",
	},
	{
		field: "defaultModeCodex",
		modes: modesFor("codex"),
		text: "default_mode_codex",
		provider: "codex",
	},
];

/** The switches saved on their own. */
type SavedSwitchField =
	| "safeMode"
	| "alwaysAskDependencies"
	| "alwaysAskBlockRemoval"
	| "allowLocalSkills";

/** The switch shown locked on: deleting always asks. */
export const LOCKED_SWITCH_FIELD = "alwaysAskDeletions";

/** One switch of the card. */
export interface SwitchRow {
	field: SavedSwitchField | typeof LOCKED_SWITCH_FIELD;
	/** The `$dms_assistant.settings` group holding the row's texts. */
	text: string;
	/** The key of the row's title in that group. */
	title: "label" | "title";
	/** Whether the row says its change applies to new conversations only. */
	hasHint: boolean;
	/** Whether the "always ask" heading opens at this row. */
	startsAlwaysAsk: boolean;
}

export const SWITCH_ROWS: readonly SwitchRow[] = [
	{
		field: "safeMode",
		text: "safe_mode",
		title: "label",
		hasHint: true,
		startsAlwaysAsk: false,
	},
	{
		field: LOCKED_SWITCH_FIELD,
		text: "always_ask_deletions",
		title: "label",
		hasHint: false,
		startsAlwaysAsk: true,
	},
	{
		field: "alwaysAskDependencies",
		text: "always_ask_dependencies",
		title: "label",
		hasHint: false,
		startsAlwaysAsk: false,
	},
	{
		field: "alwaysAskBlockRemoval",
		text: "always_ask_block_removal",
		title: "label",
		hasHint: false,
		startsAlwaysAsk: false,
	},
	{
		field: "allowLocalSkills",
		text: "allow_local_skills",
		title: "title",
		hasHint: true,
		startsAlwaysAsk: false,
	},
];

/** A field of the guard rails the card saves on its own. */
export type GuardRailField = ModeRow["field"] | SavedSwitchField;

function isText(value: unknown): value is string {
	return typeof value === "string";
}

/** The mode a radio group's value names for the provider, if it offers one. */
export function modeOf(row: ModeRow, value: unknown): ApprovalMode | undefined {
	return isText(value) ? row.modes.find((mode) => mode === value) : undefined;
}
