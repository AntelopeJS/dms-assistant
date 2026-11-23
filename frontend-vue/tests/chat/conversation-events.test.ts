import { describe, expect, it } from "vitest";
import { useConversation } from "../../app/chat/composables/useConversation";
import type { ChangeSetSummary } from "../../app/chat/types/protocol";
import { createEventBus } from "./event-bus";

const CONVERSATION_ID = "conv-1";

function changeSet(
	overrides: Partial<ChangeSetSummary> = {},
): ChangeSetSummary {
	return {
		id: "cs-14",
		number: 14,
		conversationId: CONVERSATION_ID,
		title: "Top customers",
		createdAtMs: 1,
		agent: "claude",
		scope: "safe",
		isAutoFix: false,
		overlapped: false,
		files: [
			{
				path: "sales/overview.page.ts",
				status: "modified",
				added: 14,
				removed: 1,
			},
		],
		added: 14,
		removed: 1,
		typecheck: "passed",
		state: "applied",
		approvalsNeeded: 0,
		builderOps: 2,
		...overrides,
	};
}

describe("the conversation folds the redesign's events", () => {
	it("closes a call with its outcome, how it was allowed and its change set", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({
			type: "tool_call_start",
			callId: "c1",
			toolName: "Edit",
			args: {},
		});
		b.receive({
			type: "tool_call_end",
			callId: "c1",
			status: "error",
			result: "denied",
			outcome: "denied",
			allowedBy: "denied",
		});
		expect(conversation.messages.value[0]).toMatchObject({
			outcome: "denied",
			allowedBy: "denied",
			status: "error",
		});
		expect(conversation.messages.value[0]).toHaveProperty("endedAtMs");
	});

	it("draws a change set card once and updates it when undone", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({ type: "change_set", changeSet: changeSet() });
		b.receive({
			type: "change_set",
			changeSet: changeSet({ state: "undone", stateChangedBy: "Camille" }),
		});
		const cards = conversation.messages.value.filter(
			(m) => m.role === "change_set",
		);
		expect(cards).toHaveLength(1);
		expect(conversation.changeSets.value["cs-14"]).toMatchObject({
			state: "undone",
			stateChangedBy: "Camille",
		});
	});

	it("keeps notices, the token count and the chat's mode", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({
			type: "notice",
			notice: {
				kind: "autofix",
				attempt: 1,
				maxAttempts: 2,
				errors: ["TS2339"],
				timestampMs: 5,
			},
		});
		b.receive({ type: "usage", totalTokens: 9_600 });
		b.receive({
			type: "conversation_mode",
			mode: "plan",
			generationMode: "vibe",
		});
		expect(conversation.messages.value[0]).toMatchObject({
			role: "notice",
			notice: { kind: "autofix", attempt: 1 },
		});
		expect(conversation.usage.value).toEqual({
			newTokens: 9_600,
			cacheReadTokens: 0,
		});
		expect(conversation.mode.value).toEqual({
			mode: "plan",
			generationMode: "vibe",
		});
	});
});

describe("the conversation rebuilds its transcript from a snapshot", () => {
	it("rebuilds the transcript from a snapshot with its new roles", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({
			type: "conversation_snapshot",
			messages: [
				{ role: "user", content: "go", timestampMs: 1 },
				{
					role: "tool_use",
					content: '{"command":"pnpm test"}',
					toolName: "Bash",
					callId: "c1",
					allowedBy: "rule",
					timestampMs: 2,
				},
				{
					role: "tool_result",
					content: "ok",
					callId: "c1",
					status: "success",
					outcome: "done",
					changeSetId: "cs-14",
					timestampMs: 5,
				},
				{
					role: "notice",
					content: "",
					notice: { kind: "question_skipped", header: "Sort", timestampMs: 6 },
					timestampMs: 6,
				},
				{
					role: "question_answer",
					content: "",
					answers: [
						{
							header: "Where",
							question: "Where?",
							answer: "Finance",
							skipped: false,
							isCustom: false,
						},
					],
					timestampMs: 7,
				},
				{
					role: "change_set",
					content: "",
					changeSetId: "cs-14",
					timestampMs: 8,
				},
			],
			changeSets: [changeSet()],
			mode: { mode: "acceptEdits", generationMode: "safe" },
			totalTokens: 1_200,
			cacheReadTokens: 1_000,
		});
		expect(conversation.messages.value.map((m) => m.role)).toEqual([
			"user",
			"tool",
			"notice",
			"question_answer",
			"change_set",
		]);
		expect(conversation.messages.value[1]).toMatchObject({
			outcome: "done",
			allowedBy: "rule",
			endedAtMs: 5,
		});
		expect(conversation.changeSets.value["cs-14"]?.number).toBe(14);
		expect(conversation.mode.value?.mode).toBe("acceptEdits");
		expect(conversation.usage.value).toEqual({
			newTokens: 200,
			cacheReadTokens: 1_000,
		});
	});

	it("draws a stored block preview of an earlier version as nothing (fails a transcript that keeps it or drops the messages around it)", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		const preview = {
			id: "preview-1",
			title: "Revenue KPI",
			tree: { type: "KpiCard" },
			timestampMs: 2,
		};
		b.receive({
			type: "conversation_snapshot",
			messages: [
				{ role: "user", content: "Show me a KPI", timestampMs: 1 },
				{ role: "block_preview", content: "", preview, timestampMs: 2 },
				{ role: "assistant", content: "Here it is.", timestampMs: 3 },
			],
		});
		b.receive({ type: "block_preview", preview });
		expect(
			conversation.messages.value.map((m) =>
				m.role === "user" || m.role === "assistant" ? m.content : m.role,
			),
		).toEqual(["Show me a KPI", "Here it is."]);
	});
});

describe("the conversation keeps the model that answered, and only its own events", () => {
	it("shows the model that answered, from a usage event or a snapshot", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		expect(conversation.model.value).toBeNull();
		b.receive({ type: "usage", totalTokens: 10, model: "claude-opus-5-5" });
		expect(conversation.model.value).toBe("claude-opus-5-5");
		b.receive({
			type: "conversation_snapshot",
			messages: [],
			changeSets: [],
			totalTokens: 10,
			model: "claude-sonnet-4-6",
		});
		expect(conversation.model.value).toBe("claude-sonnet-4-6");
	});

	it("keeps the notice that the configured model was refused", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({
			type: "notice",
			notice: {
				kind: "model_fallback",
				requestedModel: "claude-opus-5-5",
				usedModel: "claude-sonnet-4-6",
				timestampMs: 7,
			},
		});
		expect(conversation.messages.value[0]).toMatchObject({
			role: "notice",
			notice: { kind: "model_fallback", usedModel: "claude-sonnet-4-6" },
		});
	});

	it("ignores another conversation's events", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({ type: "usage", totalTokens: 5, conversationId: "other" });
		expect(conversation.usage.value).toBeNull();
	});
});

const TURN = [
	{
		type: "assistant_message_chunk",
		text: "I'll check two things in parallel.",
	},
	{ type: "tool_call_start", callId: "t1", toolName: "Read", args: {} },
	{
		type: "tool_call_end",
		callId: "t1",
		status: "success",
		result: "",
		outcome: "done",
	},
	{ type: "assistant_message_chunk", text: "The page has two blocks." },
	{ type: "tool_call_start", callId: "t2", toolName: "Read", args: {} },
	{
		type: "tool_call_end",
		callId: "t2",
		status: "success",
		result: "",
		outcome: "done",
	},
	{ type: "assistant_message_chunk", text: "All done." },
];
const transcriptOrder = (conversation: ReturnType<typeof useConversation>) =>
	conversation.messages.value.map((m) =>
		m.role === "assistant"
			? `text:${m.content}`
			: m.role === "tool"
				? `tool:${m.callId}`
				: m.role,
	);
const EXPECTED_ORDER = [
	"user",
	"text:I'll check two things in parallel.",
	"tool:t1",
	"text:The page has two blocks.",
	"tool:t2",
	"text:All done.",
];

describe("a running turn reads the same live, after a re-attach and after a reload", () => {
	it("keeps chunk → tool → chunk → tool → chunk interleaved through run_done", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		conversation.sendUserMessage("go");
		TURN.forEach(b.receive);
		b.receive({ type: "run_done" });
		expect(transcriptOrder(conversation)).toEqual(EXPECTED_ORDER);
	});

	it("does not append the replayed turn to its stored part on re-attach", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({
			type: "conversation_snapshot",
			messages: [
				{ role: "assistant", content: "Earlier answer.", timestampMs: 1 },
				{ role: "user", content: "go", timestampMs: 1_000 },
				{
					role: "assistant",
					content: "I'll check two things in parallel.",
					timestampMs: 1_100,
				},
				{
					role: "tool_use",
					content: "{}",
					toolName: "Read",
					callId: "t1",
					timestampMs: 1_200,
				},
				{
					role: "tool_result",
					content: "",
					callId: "t1",
					status: "success",
					outcome: "done",
					timestampMs: 1_500,
				},
				{
					role: "assistant",
					content: "The page has two blocks.",
					timestampMs: 1_600,
				},
				{
					role: "tool_use",
					content: "{}",
					toolName: "Read",
					callId: "t2",
					timestampMs: 1_700,
				},
			],
		});
		b.receive({ type: "run_resumed" });
		TURN.forEach(b.receive);
		b.receive({ type: "run_done" });
		expect(transcriptOrder(conversation)).toEqual([
			"text:Earlier answer.",
			...EXPECTED_ORDER,
		]);
	});

	it("keeps each call's own start and end through a replay", () => {
		const b = createEventBus(CONVERSATION_ID);
		const conversation = useConversation(b.options);
		b.receive({
			type: "conversation_snapshot",
			messages: [
				{ role: "user", content: "go", timestampMs: 1_000 },
				{
					role: "tool_use",
					content: "{}",
					toolName: "Read",
					callId: "t1",
					timestampMs: 1_200,
				},
				{
					role: "tool_result",
					content: "",
					callId: "t1",
					status: "success",
					outcome: "done",
					timestampMs: 1_300,
				},
			],
		});
		b.receive({ type: "run_resumed" });
		TURN.slice(1, 3).forEach(b.receive);
		const tool = conversation.messages.value.find((m) => m.role === "tool");
		expect(tool).toMatchObject({ timestampMs: 1_200, endedAtMs: 1_300 });
	});
});
