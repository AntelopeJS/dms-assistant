/**
 * @fileoverview The sidecar's wire shapes the chat reads, mirrored by hand like
 * the message types (sidecar/src/protocol). Every field the redesign added is
 * optional here: the chat must keep working against a sidecar that does not
 * send it yet.
 */
import type { MockupBlock } from "../../runtime/assistant-prompt";
import type { CHAT_ROLE, CLIENT_MESSAGE_TYPES } from "../constants/protocol";
import type { JsonObject, JsonValue } from "./json";

export type ProviderName = "claude" | "codex";
export type ApprovalMode = "normal" | "auto" | "acceptEdits" | "plan";
export type Scope = "safe" | "vibe";

export type ToolOutcome =
	| "done"
	| "failed"
	| "denied"
	| "blocked"
	| "stopped"
	| "held";

export type AllowedBy =
	| "read_auto"
	| "builder_auto"
	| "approved"
	| "rule"
	| "auto_approved"
	| "auto_denied"
	| "blocked"
	| "denied"
	| "expired";

export type RuleKind = "file" | "directory" | "command" | "domain";

export interface PermissionRule {
	kind: RuleKind;
	value: string;
}

export interface ActiveRule extends PermissionRule {
	id: string;
	label: string;
	createdAtMs: number;
}

export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
	oldLine?: number;
	newLine?: number;
}

export interface DiffHunk {
	oldStart: number;
	newStart: number;
	lines: DiffLine[];
}

export interface DiffPreview {
	type: "diff";
	path: string;
	relativePath: string;
	isNewFile: boolean;
	added: number;
	removed: number;
	hunks: DiffHunk[];
}

type CommandEffect = "adds_dependency" | "removes_dependency";

export interface CommandPreview {
	type: "command";
	command: string;
	cwd: string;
	effect?: CommandEffect;
	touches?: string[];
}

type DestructiveConsequence = "deletes_data" | "removes_code";

export interface DestructivePreview {
	type: "destructive";
	operation: string;
	target: string;
	consequence: DestructiveConsequence;
	confirmText?: string;
}

export interface WebPreview {
	type: "web";
	url: string;
	host: string;
}

interface GenericPreview {
	type: "generic";
	args: JsonObject;
}

/**
 * A Builder call the DMS holds until the person confirms it. `details` is the
 * DMS's preview from its refusal, else the call's own arguments.
 */
export interface HeldPreview {
	type: "held";
	operation: string;
	details: JsonValue;
}

/**
 * Another call to a Builder tool the DMS holds a call of. `args` are the
 * call's own, not a preview from the DMS.
 */
export interface HeldToolPreview {
	type: "held_tool";
	operation: string;
	args: JsonObject;
}

export type PermissionPreview =
	| DiffPreview
	| CommandPreview
	| DestructivePreview
	| WebPreview
	| GenericPreview
	| HeldPreview
	| HeldToolPreview;

export type PermissionKind =
	| "edit"
	| "command"
	| "web"
	| "destructive"
	| "builder"
	| "other";

export type ChangeSetState = "applied" | "undone";
export type TypecheckOutcome = "passed" | "failed" | "skipped";
export type ChangeSetFileStatus = "added" | "modified" | "deleted";

export interface ChangeSetFile {
	path: string;
	status: ChangeSetFileStatus;
	added: number;
	removed: number;
}

export interface ChangeSetSummary {
	id: string;
	number: number;
	conversationId: string;
	title: string;
	createdAtMs: number;
	agent: ProviderName;
	scope: Scope;
	isAutoFix: boolean;
	overlapped: boolean;
	files: ChangeSetFile[];
	added: number;
	removed: number;
	typecheck: TypecheckOutcome;
	state: ChangeSetState;
	stateChangedAtMs?: number;
	stateChangedBy?: string;
	askedBy?: string;
	approvalsNeeded: number;
	builderOps: number;
}

export interface AutoFixNotice {
	kind: "autofix";
	attempt: number;
	maxAttempts: number;
	errors: string[];
	timestampMs: number;
}

export interface PermissionExpiredNotice {
	kind: "permission_expired";
	toolName: string;
	summary: string;
	timestampMs: number;
}

export interface QuestionSkippedNotice {
	kind: "question_skipped";
	header: string;
	timestampMs: number;
}

export interface ModelFallbackNotice {
	kind: "model_fallback";
	requestedModel: string;
	usedModel: string;
	timestampMs: number;
}

export interface AutoUnavailableNotice {
	kind: "auto_unavailable";
	model: string;
	timestampMs: number;
}

export type Notice =
	| AutoFixNotice
	| PermissionExpiredNotice
	| QuestionSkippedNotice
	| ModelFallbackNotice
	| AutoUnavailableNotice;

export interface ConversationModeState {
	mode: ApprovalMode;
	generationMode: Scope;
}

export interface QuestionAnswerRecord {
	header: string;
	question: string;
	answer: string | null;
	skipped: boolean;
	isCustom: boolean;
}

export interface WireAttachment {
	name: string;
	mimeType: string;
	size: number;
	data: string;
}

export interface AttachmentMeta {
	name: string;
	mimeType: string;
	size: number;
}

export interface SnapshotMessage {
	role: string;
	content: string;
	toolName?: string;
	callId?: string;
	status?: string;
	attachments?: AttachmentMeta[];
	isRetryable?: boolean;
	timestampMs: number;
	outcome?: ToolOutcome;
	allowedBy?: AllowedBy;
	changeSetId?: string;
	notice?: Notice;
	answers?: QuestionAnswerRecord[];
}

export interface QueuedItemWire {
	id: string;
	content: string;
	attachments?: WireAttachment[];
}

/** The turn's page chip and mockup block: what rides along with a message. */
export interface UserTurnExtras {
	includePageContext?: boolean;
	focusBlock?: MockupBlock;
}

/** A message the chat sends for one conversation. */
export interface ConversationRequest<Type extends string> {
	type: Type;
	conversationId: string;
}

export interface HelloMessage {
	type: typeof CLIENT_MESSAGE_TYPES.HELLO;
	role: typeof CHAT_ROLE;
	conversationId: string;
	/** Follows the conversation next to the one the tab's stream shows. */
	follow?: true;
}

export interface UserTurnMessage
	extends
		ConversationRequest<typeof CLIENT_MESSAGE_TYPES.USER_MESSAGE>,
		UserTurnExtras {
	content: string;
	attachments?: WireAttachment[];
}

export interface QueuedItemRequest extends UserTurnExtras {
	id: string;
	content: string;
	attachments?: WireAttachment[];
}

export interface QueueEnqueueMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.QUEUE_ENQUEUE
> {
	item: QueuedItemRequest;
}

export interface QueueCancelMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.QUEUE_CANCEL
> {
	id: string;
}

export interface QueueUpdateMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.QUEUE_UPDATE
> {
	id: string;
	content: string;
}

export interface QueueMoveMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.QUEUE_MOVE
> {
	id: string;
	toIndex: number;
}

export interface PermissionResponseMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.PERMISSION_RESPONSE
> {
	requestId: string;
	decision: "allow_once" | "allow_rule" | "deny" | "deny_all";
	rule?: PermissionRule;
	feedback?: string;
}

export interface QuestionResponseMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.QUESTION_RESPONSE
> {
	requestId: string;
	answers: string[];
	skipped?: boolean[];
}

export interface SetConversationModeMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.SET_CONVERSATION_MODE
> {
	mode?: ApprovalMode;
	generationMode?: Scope;
}

export interface RevokeRuleMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.REVOKE_RULE
> {
	ruleId: string;
}

export interface ChangeSetActionMessage extends ConversationRequest<
	typeof CLIENT_MESSAGE_TYPES.CHANGE_SET_ACTION
> {
	changeSetId: string;
	action: "undo" | "redo";
	includeLater?: true;
}

/** Every message the chat sends to the sidecar. */
export type ClientMessage =
	| HelloMessage
	| UserTurnMessage
	| QueueEnqueueMessage
	| QueueCancelMessage
	| QueueUpdateMessage
	| QueueMoveMessage
	| ConversationRequest<typeof CLIENT_MESSAGE_TYPES.QUEUE_CLEAR>
	| PermissionResponseMessage
	| QuestionResponseMessage
	| SetConversationModeMessage
	| RevokeRuleMessage
	| ChangeSetActionMessage
	| ConversationRequest<typeof CLIENT_MESSAGE_TYPES.RETRY_TURN>
	| ConversationRequest<typeof CLIENT_MESSAGE_TYPES.INTERRUPT_TURN>
	| ConversationRequest<typeof CLIENT_MESSAGE_TYPES.STOP_AUTOFIX>
	| ConversationRequest<typeof CLIENT_MESSAGE_TYPES.DELETE_CONVERSATION>
	| { type: typeof CLIENT_MESSAGE_TYPES.LIST_CONVERSATIONS };
