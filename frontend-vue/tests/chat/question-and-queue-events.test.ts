import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useQuestionQueue } from "../../app/chat/composables/useQuestionQueue";
import { useQueueActions } from "../../app/chat/composables/useQueueActions";
import type { QueuedMessage } from "../../app/chat/types/conversation";
import { createEventBus } from "./event-bus";

const CONVERSATION_ID = "conv-1";

describe("questions can be skipped and leave a record", () => {
	it("sends answers with the skipped flags and returns the transcript record", () => {
		const b = createEventBus(CONVERSATION_ID);
		const questions = useQuestionQueue(b.options);
		b.receive({
			type: "ask_question",
			requestId: "q1",
			questions: [
				{
					question: "Where?",
					header: "Placement",
					options: [
						{ label: "Finance", description: "" },
						{ label: "Tab", description: "" },
					],
				},
				{
					question: "Sort?",
					header: "Sort",
					options: [
						{ label: "Days", description: "" },
						{ label: "Amount", description: "" },
					],
				},
				{
					question: "Action?",
					header: "Action",
					options: [
						{ label: "Send", description: "" },
						{ label: "Log", description: "" },
					],
				},
			],
		});
		const records = questions.respond("q1", [
			{ answer: "Finance", isCustom: false, skipped: false },
			{ answer: "", isCustom: false, skipped: true },
			{ answer: "Send and log it", isCustom: true, skipped: false },
		]);
		expect(b.sent[0]).toEqual({
			type: "question_response",
			conversationId: CONVERSATION_ID,
			requestId: "q1",
			answers: ["Finance", "", "Send and log it"],
			skipped: [false, true, false],
		});
		expect(
			records?.map((record) => [
				record.answer,
				record.skipped,
				record.isCustom,
			]),
		).toEqual([
			["Finance", false, false],
			[null, true, false],
			["Send and log it", false, true],
		]);
	});

	it("drops a question the sidecar timed out", () => {
		const b = createEventBus(CONVERSATION_ID);
		const questions = useQuestionQueue(b.options);
		b.receive({ type: "ask_question", requestId: "q1", questions: [] });
		b.receive({ type: "question_expired", requestId: "q1" });
		expect(questions.queue.value).toEqual([]);
	});
});

describe("the follow-up queue is edited from the chat", () => {
	it("updates, reorders, cancels and clears, showing each change at once", () => {
		const b = createEventBus(CONVERSATION_ID);
		const queued = ref<QueuedMessage[]>([
			{ id: "a", content: "first", attachments: [] },
			{ id: "b", content: "second", attachments: [] },
		]);
		const actions = useQueueActions({
			activeId: b.options.activeId,
			queued,
			send: b.options.send,
		});
		actions.update("a", "first, edited");
		actions.move("b", 0);
		expect(queued.value.map((item) => item.content)).toEqual([
			"second",
			"first, edited",
		]);
		actions.cancel("a");
		actions.clear();
		expect(queued.value).toEqual([]);
		expect(b.sent.map((msg) => msg.type)).toEqual([
			"queue_update",
			"queue_move",
			"queue_cancel",
			"queue_clear",
		]);
		expect(b.sent[1]).toEqual({
			type: "queue_move",
			conversationId: CONVERSATION_ID,
			id: "b",
			toIndex: 0,
		});
	});
});
