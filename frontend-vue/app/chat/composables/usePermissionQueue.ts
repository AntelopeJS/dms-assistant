import { type Ref, ref, shallowRef } from "vue";
import { z } from "zod";
import {
	CLIENT_MESSAGE_TYPES,
	FEEDBACK_MAX_CHARS,
	SERVER_EVENT_TYPES,
} from "../constants/protocol";
import type {
	ExpiredRequest,
	PermissionAnswer,
	PermissionRequestData,
} from "../types/permission";
import type {
	ActiveRule,
	ClientMessage,
	PermissionResponseMessage,
} from "../types/protocol";
import { JSON_VALUE_SCHEMA } from "../utils/json";
import {
	isForConversation,
	parseEvent,
	type WireEnvelope,
} from "../utils/wire-envelope";
import {
	ACTIVE_RULE_SCHEMA,
	PERMISSION_KIND_SCHEMA,
	PERMISSION_PREVIEW_SCHEMA,
	PERMISSION_RULE_SCHEMA,
} from "../utils/wire-schemas";

export interface UsePermissionQueueOptions {
	activeId: Ref<string>;
	send: (msg: ClientMessage) => boolean;
	onMessage: (handler: (msg: WireEnvelope) => void) => () => void;
}

export interface UsePermissionQueueResult {
	/** The active chat's pending requests, oldest first. */
	queue: Ref<PermissionRequestData[]>;
	/** Requests that went unanswered, until dismissed or asked again. */
	expired: Ref<ExpiredRequest[]>;
	/** What the user allowed for the rest of this chat. */
	rules: Ref<ActiveRule[]>;
	respond: (requestId: string, answer: PermissionAnswer) => void;
	/** Denies every pending request of the chat and stops its turn. */
	denyAll: () => void;
	revokeRule: (ruleId: string) => void;
	dismissExpired: (requestId: string) => void;
	clear: () => void;
}

const PERMISSION_REQUEST_SCHEMA = z.object({
	conversationId: z.string(),
	requestId: z.string(),
	callId: z.string().optional(),
	toolName: z.string(),
	args: JSON_VALUE_SCHEMA.optional(),
	summary: z.string(),
	kind: PERMISSION_KIND_SCHEMA,
	alwaysAsk: z.boolean(),
	preview: PERMISSION_PREVIEW_SCHEMA,
	ruleOptions: z.array(PERMISSION_RULE_SCHEMA),
	createdAtMs: z.number(),
	expiresAtMs: z.number(),
});

const PERMISSION_EXPIRED_SCHEMA = z.object({
	conversationId: z.string(),
	requestId: z.string(),
	toolName: z.string().optional(),
	summary: z.string().optional(),
	expiredAtMs: z.number().optional(),
});

const REQUEST_ID_SCHEMA = z.object({ requestId: z.string() });

const RULES_STATE_SCHEMA = z.object({
	rules: z.array(ACTIVE_RULE_SCHEMA).optional(),
});

type PermissionRequestWire = z.infer<typeof PERMISSION_REQUEST_SCHEMA>;
type PermissionExpiredWire = z.infer<typeof PERMISSION_EXPIRED_SCHEMA>;

interface QueueState {
	options: UsePermissionQueueOptions;
	queue: Ref<PermissionRequestData[]>;
	expired: Ref<ExpiredRequest[]>;
	rules: Ref<ActiveRule[]>;
}

type QueueHandler = (state: QueueState, envelope: WireEnvelope) => void;

/** A request as the dock reads it: an always-ask one never offers a rule. */
function toPermissionRequest(
	wire: PermissionRequestWire,
): PermissionRequestData {
	return {
		requestId: wire.requestId,
		conversationId: wire.conversationId,
		callId: wire.callId,
		toolName: wire.toolName,
		args: wire.args,
		summary: wire.summary,
		kind: wire.kind,
		alwaysAsk: wire.alwaysAsk,
		preview: wire.preview,
		ruleOptions: wire.alwaysAsk ? [] : wire.ruleOptions,
		createdAtMs: wire.createdAtMs,
		expiresAtMs: wire.expiresAtMs,
	};
}

function without(state: QueueState, requestId: string): void {
	state.queue.value = state.queue.value.filter(
		(req) => req.requestId !== requestId,
	);
}

function enqueue(state: QueueState, wire: PermissionRequestWire): void {
	if (state.queue.value.some((req) => req.requestId === wire.requestId)) return;
	state.queue.value = [...state.queue.value, toPermissionRequest(wire)];
}

function expire(state: QueueState, wire: PermissionExpiredWire): void {
	const pending = state.queue.value.find(
		(req) => req.requestId === wire.requestId,
	);
	without(state, wire.requestId);
	if (state.expired.value.some((req) => req.requestId === wire.requestId))
		return;
	state.expired.value = [
		...state.expired.value,
		{
			requestId: wire.requestId,
			conversationId: wire.conversationId,
			toolName: wire.toolName ?? pending?.toolName ?? "",
			summary: wire.summary ?? pending?.summary ?? "",
			expiredAtMs: wire.expiredAtMs ?? Date.now(),
		},
	];
}

function folds<Event>(
	schema: z.ZodType<Event>,
	apply: (state: QueueState, event: Event) => void,
): QueueHandler {
	return (state, envelope) => {
		const event = parseEvent(schema, envelope);
		if (event !== null) apply(state, event);
	};
}

const HANDLERS: ReadonlyMap<string, QueueHandler> = new Map([
	[
		SERVER_EVENT_TYPES.PERMISSION_REQUEST,
		folds(PERMISSION_REQUEST_SCHEMA, enqueue),
	],
	[
		SERVER_EVENT_TYPES.PERMISSION_EXPIRED,
		folds(PERMISSION_EXPIRED_SCHEMA, expire),
	],
	[
		SERVER_EVENT_TYPES.PERMISSION_RESOLVED,
		folds(REQUEST_ID_SCHEMA, (state, event) => without(state, event.requestId)),
	],
	[
		SERVER_EVENT_TYPES.RULES_STATE,
		folds(RULES_STATE_SCHEMA, (state, event) => {
			state.rules.value = event.rules ?? [];
		}),
	],
]);

function dispatch(state: QueueState, envelope: WireEnvelope): void {
	const handler = HANDLERS.get(envelope.type);
	if (handler === undefined) return;
	if (!isForConversation(envelope, state.options.activeId.value)) return;
	handler(state, envelope);
}

function answerMessage(
	req: PermissionRequestData,
	answer: PermissionAnswer,
): PermissionResponseMessage {
	const message: PermissionResponseMessage = {
		type: CLIENT_MESSAGE_TYPES.PERMISSION_RESPONSE,
		conversationId: req.conversationId,
		requestId: req.requestId,
		decision: answer.decision,
	};
	if (answer.rule !== undefined) message.rule = answer.rule;
	const feedback = answer.feedback?.trim().slice(0, FEEDBACK_MAX_CHARS);
	if (feedback) message.feedback = feedback;
	return message;
}

function respond(
	state: QueueState,
	requestId: string,
	answer: PermissionAnswer,
): void {
	const target = state.queue.value.find((req) => req.requestId === requestId);
	if (target === undefined) return;
	if (!state.options.send(answerMessage(target, answer))) return;
	without(state, requestId);
}

function denyAll(state: QueueState): void {
	const first = state.queue.value[0];
	if (first === undefined) return;
	const isSent = state.options.send({
		type: CLIENT_MESSAGE_TYPES.PERMISSION_RESPONSE,
		conversationId: first.conversationId,
		requestId: first.requestId,
		decision: "deny_all",
	});
	if (isSent) state.queue.value = [];
}

function revokeRule(state: QueueState, ruleId: string): void {
	const isSent = state.options.send({
		type: CLIENT_MESSAGE_TYPES.REVOKE_RULE,
		conversationId: state.options.activeId.value,
		ruleId,
	});
	if (!isSent) return;
	state.rules.value = state.rules.value.filter((rule) => rule.id !== ruleId);
}

/**
 * The approvals of the active chat: pending requests with their previews,
 * those that expired, and the rules the user granted. Requests another tab
 * answered leave as soon as the sidecar says so.
 */
export function usePermissionQueue(
	options: UsePermissionQueueOptions,
): UsePermissionQueueResult {
	const state: QueueState = {
		options,
		queue: shallowRef<PermissionRequestData[]>([]),
		expired: ref<ExpiredRequest[]>([]),
		rules: ref<ActiveRule[]>([]),
	};
	options.onMessage((msg) => dispatch(state, msg));
	return {
		queue: state.queue,
		expired: state.expired,
		rules: state.rules,
		respond: (requestId, answer) => respond(state, requestId, answer),
		denyAll: () => denyAll(state),
		revokeRule: (ruleId) => revokeRule(state, ruleId),
		dismissExpired: (requestId) => {
			state.expired.value = state.expired.value.filter(
				(req) => req.requestId !== requestId,
			);
		},
		clear: () => {
			state.queue.value = [];
			state.expired.value = [];
			state.rules.value = [];
		},
	};
}
