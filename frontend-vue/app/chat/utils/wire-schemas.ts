/**
 * @fileoverview The shapes of the sidecar's events the chat folds, checked as
 * they arrive. Each schema is typed by the interface the chat reads it as, so
 * the two cannot drift apart; every field the redesign added stays optional
 * for a sidecar that does not send it yet.
 */
import { z } from "zod";
import type {
	ActiveRule,
	AllowedBy,
	AttachmentMeta,
	ChangeSetFile,
	ChangeSetSummary,
	ConversationModeState,
	DiffHunk,
	DiffLine,
	Notice,
	PermissionKind,
	PermissionPreview,
	PermissionRule,
	QuestionAnswerRecord,
	QueuedItemWire,
	SnapshotMessage,
	ToolOutcome,
	WireAttachment,
} from "../types/protocol";
import type { QuestionData } from "../types/question";
import { JSON_VALUE_SCHEMA } from "./json";

export const TOOL_OUTCOME_SCHEMA: z.ZodType<ToolOutcome> = z.enum([
	"done",
	"failed",
	"denied",
	"blocked",
	"stopped",
	"held",
]);

export const ALLOWED_BY_SCHEMA: z.ZodType<AllowedBy> = z.enum([
	"read_auto",
	"builder_auto",
	"approved",
	"rule",
	"auto_approved",
	"auto_denied",
	"blocked",
	"denied",
	"expired",
]);

export const PROVIDER_NAME_SCHEMA = z.enum(["claude", "codex"]);
export const APPROVAL_MODE_SCHEMA = z.enum([
	"normal",
	"auto",
	"acceptEdits",
	"plan",
]);
export const SCOPE_SCHEMA = z.enum(["safe", "vibe"]);

const RULE_KIND_SCHEMA = z.enum(["file", "directory", "command", "domain"]);

export const PERMISSION_RULE_SCHEMA: z.ZodType<PermissionRule> = z.object({
	kind: RULE_KIND_SCHEMA,
	value: z.string(),
});

export const ACTIVE_RULE_SCHEMA: z.ZodType<ActiveRule> = z.object({
	kind: RULE_KIND_SCHEMA,
	value: z.string(),
	id: z.string(),
	label: z.string(),
	createdAtMs: z.number(),
});

export const PERMISSION_KIND_SCHEMA: z.ZodType<PermissionKind> = z.enum([
	"edit",
	"command",
	"web",
	"destructive",
	"builder",
	"other",
]);

const DIFF_LINE_SCHEMA: z.ZodType<DiffLine> = z.object({
	kind: z.enum(["context", "add", "remove"]),
	text: z.string(),
	oldLine: z.number().optional(),
	newLine: z.number().optional(),
});

const DIFF_HUNK_SCHEMA: z.ZodType<DiffHunk> = z.object({
	oldStart: z.number(),
	newStart: z.number(),
	lines: z.array(DIFF_LINE_SCHEMA),
});

const DIFF_PREVIEW_SCHEMA = z.object({
	type: z.literal("diff"),
	path: z.string(),
	relativePath: z.string(),
	isNewFile: z.boolean(),
	added: z.number(),
	removed: z.number(),
	hunks: z.array(DIFF_HUNK_SCHEMA),
});

const COMMAND_PREVIEW_SCHEMA = z.object({
	type: z.literal("command"),
	command: z.string(),
	cwd: z.string(),
	effect: z.enum(["adds_dependency", "removes_dependency"]).optional(),
	touches: z.array(z.string()).optional(),
});

const DESTRUCTIVE_PREVIEW_SCHEMA = z.object({
	type: z.literal("destructive"),
	operation: z.string(),
	target: z.string(),
	consequence: z.enum(["deletes_data", "removes_code"]),
	confirmText: z.string().optional(),
});

const WEB_PREVIEW_SCHEMA = z.object({
	type: z.literal("web"),
	url: z.string(),
	host: z.string(),
});

const HELD_PREVIEW_SCHEMA = z.object({
	type: z.literal("held"),
	operation: z.string(),
	details: JSON_VALUE_SCHEMA,
});

const HELD_TOOL_PREVIEW_SCHEMA = z.object({
	type: z.literal("held_tool"),
	operation: z.string(),
	args: z.record(z.string(), JSON_VALUE_SCHEMA),
});

export const PERMISSION_PREVIEW_SCHEMA: z.ZodType<PermissionPreview> =
	z.discriminatedUnion("type", [
		DIFF_PREVIEW_SCHEMA,
		COMMAND_PREVIEW_SCHEMA,
		DESTRUCTIVE_PREVIEW_SCHEMA,
		WEB_PREVIEW_SCHEMA,
		z.object({
			type: z.literal("generic"),
			args: z.record(z.string(), JSON_VALUE_SCHEMA),
		}),
		HELD_PREVIEW_SCHEMA,
		HELD_TOOL_PREVIEW_SCHEMA,
	]);

export const QUESTION_SCHEMA: z.ZodType<QuestionData> = z.object({
	question: z.string(),
	header: z.string(),
	options: z.array(
		z.object({
			label: z.string(),
			description: z.string().default(""),
			preview: z.string().optional(),
		}),
	),
});

export const NOTICE_SCHEMA: z.ZodType<Notice> = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("autofix"),
		attempt: z.number(),
		maxAttempts: z.number(),
		errors: z.array(z.string()),
		timestampMs: z.number(),
	}),
	z.object({
		kind: z.literal("permission_expired"),
		toolName: z.string(),
		summary: z.string(),
		timestampMs: z.number(),
	}),
	z.object({
		kind: z.literal("question_skipped"),
		header: z.string(),
		timestampMs: z.number(),
	}),
	z.object({
		kind: z.literal("model_fallback"),
		requestedModel: z.string(),
		usedModel: z.string(),
		timestampMs: z.number(),
	}),
	z.object({
		kind: z.literal("auto_unavailable"),
		model: z.string(),
		timestampMs: z.number(),
	}),
]);

const QUESTION_ANSWER_RECORD_SCHEMA: z.ZodType<QuestionAnswerRecord> = z.object(
	{
		header: z.string(),
		question: z.string(),
		answer: z.string().nullable(),
		skipped: z.boolean(),
		isCustom: z.boolean(),
	},
);

const ATTACHMENT_META_SCHEMA: z.ZodType<AttachmentMeta> = z.object({
	name: z.string(),
	mimeType: z.string(),
	size: z.number(),
});

export const ATTACHMENT_META_LIST_SCHEMA = z.array(ATTACHMENT_META_SCHEMA);

const WIRE_ATTACHMENT_SCHEMA: z.ZodType<WireAttachment> = z.object({
	name: z.string(),
	mimeType: z.string(),
	size: z.number(),
	data: z.string(),
});

export const QUEUED_ITEM_SCHEMA: z.ZodType<QueuedItemWire> = z.object({
	id: z.string(),
	content: z.string(),
	attachments: z.array(WIRE_ATTACHMENT_SCHEMA).optional(),
});

export const SNAPSHOT_MESSAGE_SCHEMA: z.ZodType<SnapshotMessage> = z.object({
	role: z.string(),
	content: z.string(),
	toolName: z.string().optional(),
	callId: z.string().optional(),
	status: z.string().optional(),
	attachments: z.array(ATTACHMENT_META_SCHEMA).optional(),
	isRetryable: z.boolean().optional(),
	timestampMs: z.number(),
	outcome: TOOL_OUTCOME_SCHEMA.optional(),
	allowedBy: ALLOWED_BY_SCHEMA.optional(),
	changeSetId: z.string().optional(),
	notice: NOTICE_SCHEMA.optional(),
	answers: z.array(QUESTION_ANSWER_RECORD_SCHEMA).optional(),
});

const CHANGE_SET_FILE_SCHEMA: z.ZodType<ChangeSetFile> = z.object({
	path: z.string(),
	status: z.enum(["added", "modified", "deleted"]),
	added: z.number(),
	removed: z.number(),
});

export const CHANGE_SET_SCHEMA: z.ZodType<ChangeSetSummary> = z.object({
	id: z.string(),
	number: z.number(),
	conversationId: z.string(),
	title: z.string(),
	createdAtMs: z.number(),
	agent: PROVIDER_NAME_SCHEMA,
	scope: SCOPE_SCHEMA,
	isAutoFix: z.boolean(),
	overlapped: z.boolean(),
	files: z.array(CHANGE_SET_FILE_SCHEMA),
	added: z.number(),
	removed: z.number(),
	typecheck: z.enum(["passed", "failed", "skipped"]),
	state: z.enum(["applied", "undone"]),
	stateChangedAtMs: z.number().optional(),
	stateChangedBy: z.string().optional(),
	askedBy: z.string().optional(),
	approvalsNeeded: z.number(),
	builderOps: z.number(),
});

/** What the chat keeps of a conversation's mode: both halves, or none. */
export const MODE_STATE_SCHEMA: z.ZodType<ConversationModeState> = z.object({
	mode: APPROVAL_MODE_SCHEMA,
	generationMode: SCOPE_SCHEMA,
});
