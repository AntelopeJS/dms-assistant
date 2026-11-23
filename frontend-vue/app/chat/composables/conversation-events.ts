import { z } from "zod";
import { MESSAGE_ROLES } from "../constants/conversation";
import { SERVER_EVENT_TYPES } from "../constants/protocol";
import type {
	ConversationMessage,
	ToolCallMessage,
} from "../types/conversation";
import type { ChangeSetSummary, WireAttachment } from "../types/protocol";
import type { PendingAttachment } from "../utils/attachments";
import {
	buildAssistantMessage,
	buildErrorMessage,
	buildUserMessage,
	closedStatus,
	settleOpenTools,
	snapshotToMessages,
} from "../utils/conversation-messages";
import { newUuid } from "../utils/ids";
import { JSON_VALUE_SCHEMA } from "../utils/json";
import { toActivityKind } from "../utils/run-status";
import { tokenTally } from "../utils/token-tally";
import {
	isForConversation,
	parseEvent,
	type WireEnvelope,
} from "../utils/wire-envelope";
import {
	ALLOWED_BY_SCHEMA,
	APPROVAL_MODE_SCHEMA,
	ATTACHMENT_META_LIST_SCHEMA,
	CHANGE_SET_SCHEMA,
	NOTICE_SCHEMA,
	QUEUED_ITEM_SCHEMA,
	SCOPE_SCHEMA,
	SNAPSHOT_MESSAGE_SCHEMA,
	TOOL_OUTCOME_SCHEMA,
} from "../utils/wire-schemas";
import type { ConversationState } from "./useConversation";

const CHUNK_SCHEMA = z.object({ text: z.string() });

const TOOL_START_SCHEMA = z.object({
	callId: z.string(),
	toolName: z.string(),
	args: JSON_VALUE_SCHEMA.optional(),
});

const TOOL_END_SCHEMA = z.object({
	callId: z.string(),
	status: z.string().optional(),
	result: JSON_VALUE_SCHEMA.optional(),
	outcome: TOOL_OUTCOME_SCHEMA.optional(),
	allowedBy: ALLOWED_BY_SCHEMA.optional(),
	changeSetId: z.string().optional(),
});

const RUN_ERROR_SCHEMA = z.object({
	error: z.string(),
	isRetryable: z.boolean().optional(),
});

const RUN_PROGRESS_SCHEMA = z.object({
	activity: z.string(),
	detail: z.string().optional(),
	elapsedMs: z.number().default(0),
	idleMs: z.number().default(0),
});

const MODE_SCHEMA = z.object({
	mode: APPROVAL_MODE_SCHEMA.optional(),
	generationMode: SCOPE_SCHEMA.optional(),
});

type ChunkEvent = z.infer<typeof CHUNK_SCHEMA>;
type ToolStartEvent = z.infer<typeof TOOL_START_SCHEMA>;
type ToolEndEvent = z.infer<typeof TOOL_END_SCHEMA>;
type RunErrorEvent = z.infer<typeof RUN_ERROR_SCHEMA>;
type RunProgressEvent = z.infer<typeof RUN_PROGRESS_SCHEMA>;
type ModeWire = z.infer<typeof MODE_SCHEMA>;

const SNAPSHOT_SCHEMA = z.object({
	messages: z.array(SNAPSHOT_MESSAGE_SCHEMA).optional(),
	changeSets: z.array(CHANGE_SET_SCHEMA).optional(),
	mode: MODE_SCHEMA.optional(),
	totalTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	model: z.string().optional(),
});

const QUEUE_STATE_SCHEMA = z.object({
	items: z.array(QUEUED_ITEM_SCHEMA).optional(),
});

const USER_MESSAGE_ECHO_SCHEMA = z.object({
	content: z.string(),
	attachments: ATTACHMENT_META_LIST_SCHEMA.optional(),
	timestampMs: z.number().optional(),
});

const NOTICE_EVENT_SCHEMA = z.object({ notice: NOTICE_SCHEMA.optional() });

const CHANGE_SET_EVENT_SCHEMA = z.object({
	changeSet: CHANGE_SET_SCHEMA.optional(),
});

const USAGE_SCHEMA = z.object({
	totalTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	model: z.string().optional(),
});

type SnapshotEvent = z.infer<typeof SNAPSHOT_SCHEMA>;
type QueueStateEvent = z.infer<typeof QUEUE_STATE_SCHEMA>;
type UserMessageEchoEvent = z.infer<typeof USER_MESSAGE_ECHO_SCHEMA>;
type NoticeEvent = z.infer<typeof NOTICE_EVENT_SCHEMA>;
type ChangeSetEvent = z.infer<typeof CHANGE_SET_EVENT_SCHEMA>;
type UsageEvent = z.infer<typeof USAGE_SCHEMA>;

type EventHandler = (state: ConversationState, envelope: WireEnvelope) => void;

function setMessages(
	state: ConversationState,
	next: ConversationMessage[],
): void {
	state.messages.value = next;
}

function appendMessage(
	state: ConversationState,
	message: ConversationMessage,
): void {
	setMessages(state, [...state.messages.value, message]);
}

function endTurn(state: ConversationState): void {
	setMessages(state, settleOpenTools(state.messages.value));
	state.progress.value = null;
	state.isTurnInFlight.value = false;
	state.isRunning.value = state.queued.value.length > 0;
}

function appendChunk(state: ConversationState, event: ChunkEvent): void {
	const list = state.messages.value;
	const last = list.at(-1);
	if (last?.role !== MESSAGE_ROLES.ASSISTANT) {
		appendMessage(state, buildAssistantMessage(event.text));
		return;
	}
	setMessages(state, [
		...list.slice(0, -1),
		{ ...last, content: last.content + event.text },
	]);
}

function isCall(msg: ConversationMessage, callId: string): boolean {
	return msg.role === MESSAGE_ROLES.TOOL && msg.callId === callId;
}

function startTool(state: ConversationState, event: ToolStartEvent): void {
	const list = state.messages.value;
	if (list.some((msg) => isCall(msg, event.callId))) {
		setMessages(
			state,
			list.map((msg) =>
				isCall(msg, event.callId)
					? { ...msg, toolName: event.toolName, args: event.args }
					: msg,
			),
		);
		return;
	}
	const tool: ToolCallMessage = {
		id: newUuid(),
		role: MESSAGE_ROLES.TOOL,
		callId: event.callId,
		toolName: event.toolName,
		args: event.args,
		status: "pending",
		timestampMs: state.callTimes.get(event.callId)?.startedAtMs ?? Date.now(),
	};
	appendMessage(state, tool);
}

function endTool(state: ConversationState, event: ToolEndEvent): void {
	const endedAtMs = state.callTimes.get(event.callId)?.endedAtMs ?? Date.now();
	setMessages(
		state,
		state.messages.value.map((msg) => {
			if (!isCall(msg, event.callId) || msg.role !== MESSAGE_ROLES.TOOL)
				return msg;
			return {
				...msg,
				status: closedStatus(event.outcome, event.status),
				result: event.result,
				outcome: event.outcome,
				allowedBy: event.allowedBy ?? msg.allowedBy,
				changeSetId: event.changeSetId,
				endedAtMs,
			};
		}),
	);
}

function failRun(state: ConversationState, event: RunErrorEvent): void {
	endTurn(state);
	appendMessage(
		state,
		buildErrorMessage(event.error, event.isRetryable ?? true),
	);
}

function isTurnStart(msg: ConversationMessage): boolean {
	if (msg.role === MESSAGE_ROLES.USER) return true;
	return msg.role === MESSAGE_ROLES.NOTICE && msg.notice.kind === "autofix";
}

/** Kept through a replay: stored outside the turn's own events. */
function isOutOfTurn(msg: ConversationMessage): boolean {
	return (
		msg.role === MESSAGE_ROLES.NOTICE ||
		msg.role === MESSAGE_ROLES.QUESTION_ANSWER
	);
}

/**
 * The transcript up to where the running turn began. A re-attach sends the
 * stored transcript, then `run_resumed` and every event of the running turn
 * from its start: the turn's stored part makes way for that replay, or its
 * texts would be appended twice.
 */
function withoutRunningTurn(
	list: ConversationMessage[],
): ConversationMessage[] {
	const start = lastIndexWhere(list, isTurnStart);
	return [
		...list.slice(0, start + 1),
		...list.slice(start + 1).filter(isOutOfTurn),
	];
}

function lastIndexWhere(
	list: ConversationMessage[],
	predicate: (msg: ConversationMessage) => boolean,
): number {
	for (let index = list.length - 1; index >= 0; index -= 1)
		if (predicate(list[index])) return index;
	return -1;
}

function resumeRun(state: ConversationState): void {
	setMessages(state, withoutRunningTurn(state.messages.value));
	state.isRunning.value = true;
	state.isTurnInFlight.value = true;
	state.lastEventAtMs.value = Date.now();
}

function reportProgress(
	state: ConversationState,
	event: RunProgressEvent,
): void {
	state.progress.value = {
		activity: toActivityKind(event.activity),
		detail: event.detail,
		elapsedMs: event.elapsedMs,
		idleMs: event.idleMs,
		receivedAtMs: Date.now(),
	};
	state.isRunning.value = true;
	state.isTurnInFlight.value = true;
}

function toModeState(wire: ModeWire | undefined) {
	if (wire?.mode === undefined || wire.generationMode === undefined)
		return null;
	return {
		mode: wire.mode,
		generationMode: wire.generationMode,
	};
}

function byId(sets: readonly ChangeSetSummary[]) {
	return Object.fromEntries(sets.map((set) => [set.id, set]));
}

function rememberCallTimes(
	state: ConversationState,
	list: ConversationMessage[],
): void {
	state.callTimes.clear();
	for (const msg of list) {
		if (msg.role !== MESSAGE_ROLES.TOOL) continue;
		state.callTimes.set(msg.callId, {
			startedAtMs: msg.timestampMs,
			endedAtMs: msg.endedAtMs,
		});
	}
}

function applySnapshot(state: ConversationState, event: SnapshotEvent): void {
	const messages = snapshotToMessages(event.messages ?? []);
	rememberCallTimes(state, messages);
	setMessages(state, messages);
	state.changeSets.value = byId(event.changeSets ?? []);
	state.mode.value = toModeState(event.mode) ?? state.mode.value;
	if (event.totalTokens !== undefined)
		state.usage.value = tokenTally(event.totalTokens, event.cacheReadTokens);
	state.model.value = event.model ?? null;
	state.isRunning.value = false;
	state.progress.value = null;
	state.isTurnInFlight.value = false;
}

function toPendingAttachment(wire: WireAttachment): PendingAttachment {
	return {
		id: newUuid(),
		name: wire.name,
		mimeType: wire.mimeType,
		size: wire.size,
		data: wire.data,
		dataUrl: `data:${wire.mimeType};base64,${wire.data}`,
	};
}

function applyQueue(state: ConversationState, event: QueueStateEvent): void {
	state.queued.value = (event.items ?? []).map((item) => ({
		id: item.id,
		content: item.content,
		attachments: (item.attachments ?? []).map(toPendingAttachment),
	}));
}

function echoUserMessage(
	state: ConversationState,
	event: UserMessageEchoEvent,
): void {
	const attachments = (event.attachments ?? []).map((meta) => ({ ...meta }));
	appendMessage(
		state,
		buildUserMessage(
			event.content,
			attachments.length > 0 ? attachments : undefined,
			undefined,
			event.timestampMs ?? Date.now(),
		),
	);
}

function applyMode(state: ConversationState, event: ModeWire): void {
	state.mode.value = toModeState(event) ?? state.mode.value;
}

function appendNotice(state: ConversationState, event: NoticeEvent): void {
	if (event.notice === undefined) return;
	appendMessage(state, {
		id: newUuid(),
		role: MESSAGE_ROLES.NOTICE,
		notice: event.notice,
		timestampMs: event.notice.timestampMs ?? Date.now(),
	});
}

function hasCardFor(state: ConversationState, changeSetId: string): boolean {
	return state.messages.value.some(
		(msg) =>
			msg.role === MESSAGE_ROLES.CHANGE_SET && msg.changeSetId === changeSetId,
	);
}

function applyChangeSet(state: ConversationState, event: ChangeSetEvent): void {
	const set = event.changeSet;
	if (set === undefined) return;
	state.changeSets.value = { ...state.changeSets.value, [set.id]: set };
	if (hasCardFor(state, set.id)) return;
	appendMessage(state, {
		id: newUuid(),
		role: MESSAGE_ROLES.CHANGE_SET,
		changeSetId: set.id,
		timestampMs: set.createdAtMs,
	});
}

function applyUsage(state: ConversationState, event: UsageEvent): void {
	if (event.model !== undefined) state.model.value = event.model;
	if (event.totalTokens === undefined) return;
	state.usage.value = tokenTally(event.totalTokens, event.cacheReadTokens);
}

function folds<Event>(
	schema: z.ZodType<Event>,
	apply: (state: ConversationState, event: Event) => void,
): EventHandler {
	return (state, envelope) => {
		const event = parseEvent(schema, envelope);
		if (event !== null) apply(state, event);
	};
}

const EVENT_HANDLERS: ReadonlyMap<string, EventHandler> = new Map([
	[
		SERVER_EVENT_TYPES.ASSISTANT_MESSAGE_CHUNK,
		folds(CHUNK_SCHEMA, appendChunk),
	],
	[SERVER_EVENT_TYPES.TOOL_CALL_START, folds(TOOL_START_SCHEMA, startTool)],
	[SERVER_EVENT_TYPES.TOOL_CALL_END, folds(TOOL_END_SCHEMA, endTool)],
	[SERVER_EVENT_TYPES.RUN_DONE, endTurn],
	[SERVER_EVENT_TYPES.RUN_ERROR, folds(RUN_ERROR_SCHEMA, failRun)],
	[SERVER_EVENT_TYPES.RUN_RESUMED, resumeRun],
	[SERVER_EVENT_TYPES.RUN_PROGRESS, folds(RUN_PROGRESS_SCHEMA, reportProgress)],
	[
		SERVER_EVENT_TYPES.CONVERSATION_SNAPSHOT,
		folds(SNAPSHOT_SCHEMA, applySnapshot),
	],
	[SERVER_EVENT_TYPES.QUEUE_STATE, folds(QUEUE_STATE_SCHEMA, applyQueue)],
	[
		SERVER_EVENT_TYPES.USER_MESSAGE_ECHO,
		folds(USER_MESSAGE_ECHO_SCHEMA, echoUserMessage),
	],
	[SERVER_EVENT_TYPES.CONVERSATION_MODE, folds(MODE_SCHEMA, applyMode)],
	[SERVER_EVENT_TYPES.NOTICE, folds(NOTICE_EVENT_SCHEMA, appendNotice)],
	[
		SERVER_EVENT_TYPES.CHANGE_SET,
		folds(CHANGE_SET_EVENT_SCHEMA, applyChangeSet),
	],
	[SERVER_EVENT_TYPES.USAGE, folds(USAGE_SCHEMA, applyUsage)],
]);

/** Folds one sidecar event into the active conversation; others are ignored. */
export function dispatchConversationEvent(
	state: ConversationState,
	envelope: WireEnvelope,
): void {
	const handler = EVENT_HANDLERS.get(envelope.type);
	if (handler === undefined) return;
	if (!isForConversation(envelope, state.options.activeId.value)) return;
	state.lastEventAtMs.value = Date.now();
	handler(state, envelope);
}
