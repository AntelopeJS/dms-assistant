import { type Ref, ref } from "vue";
import { z } from "zod";
import {
	CLIENT_MESSAGE_TYPES,
	SERVER_EVENT_TYPES,
} from "../constants/protocol";
import type {
	ClientMessage,
	QuestionAnswerRecord,
	QuestionResponseMessage,
} from "../types/protocol";
import type {
	QuestionData,
	QuestionReply,
	QuestionRequestData,
} from "../types/question";
import {
	isForConversation,
	parseEvent,
	type WireEnvelope,
} from "../utils/wire-envelope";
import { QUESTION_SCHEMA } from "../utils/wire-schemas";

export interface UseQuestionQueueOptions {
	activeId: Ref<string>;
	send: (msg: ClientMessage) => boolean;
	onMessage: (handler: (msg: WireEnvelope) => void) => () => void;
}

export interface UseQuestionQueueResult {
	queue: Ref<QuestionRequestData[]>;
	/**
	 * Sends the replies, one per question. Answers what the transcript keeps of
	 * them, or null when nothing was sent.
	 */
	respond: (
		requestId: string,
		replies: QuestionReply[],
	) => QuestionAnswerRecord[] | null;
	clear: () => void;
}

const ASK_QUESTION_SCHEMA = z.object({
	conversationId: z.string().optional(),
	requestId: z.string(),
	questions: z.array(QUESTION_SCHEMA),
	createdAtMs: z.number().default(0),
	expiresAtMs: z.number().default(0),
});

const REQUEST_ID_SCHEMA = z.object({ requestId: z.string() });

type AskQuestionWire = z.infer<typeof ASK_QUESTION_SCHEMA>;

/** A question that names no chat is the active chat's. */
function toRequest(
	wire: AskQuestionWire,
	activeId: string,
): QuestionRequestData {
	return {
		requestId: wire.requestId,
		conversationId: wire.conversationId ?? activeId,
		questions: wire.questions,
		createdAtMs: wire.createdAtMs,
		expiresAtMs: wire.expiresAtMs,
	};
}

/** What the transcript keeps of each answer. */
function toAnswerRecords(
	questions: readonly QuestionData[],
	replies: readonly QuestionReply[],
): QuestionAnswerRecord[] {
	return questions.map((question, index) => {
		const reply = replies[index];
		const isSkipped = reply === undefined || reply.skipped;
		return {
			header: question.header,
			question: question.question,
			answer: isSkipped ? null : reply.answer,
			skipped: isSkipped,
			isCustom: !isSkipped && reply.isCustom,
		};
	});
}

function responseMessage(
	req: QuestionRequestData,
	replies: readonly QuestionReply[],
): QuestionResponseMessage {
	const skipped = req.questions.map(
		(_, index) => replies[index]?.skipped ?? true,
	);
	const message: QuestionResponseMessage = {
		type: CLIENT_MESSAGE_TYPES.QUESTION_RESPONSE,
		conversationId: req.conversationId,
		requestId: req.requestId,
		answers: req.questions.map((_, index) =>
			skipped[index] ? "" : (replies[index]?.answer ?? ""),
		),
	};
	if (skipped.some(Boolean)) message.skipped = skipped;
	return message;
}

/**
 * The questions the agent waits on in the active chat. Answering sends the
 * replies and gives back what the transcript keeps of them; a question the
 * sidecar timed out simply leaves.
 */
export function useQuestionQueue(
	options: UseQuestionQueueOptions,
): UseQuestionQueueResult {
	const queue = ref<QuestionRequestData[]>([]);
	const drop = (requestId: string): void => {
		queue.value = queue.value.filter((req) => req.requestId !== requestId);
	};

	options.onMessage((envelope) => {
		if (!isForConversation(envelope, options.activeId.value)) return;
		if (envelope.type === SERVER_EVENT_TYPES.QUESTION_EXPIRED) {
			const expired = parseEvent(REQUEST_ID_SCHEMA, envelope);
			if (expired !== null) drop(expired.requestId);
			return;
		}
		if (envelope.type !== SERVER_EVENT_TYPES.ASK_QUESTION) return;
		const wire = parseEvent(ASK_QUESTION_SCHEMA, envelope);
		if (wire === null) return;
		if (queue.value.some((req) => req.requestId === wire.requestId)) return;
		queue.value = [...queue.value, toRequest(wire, options.activeId.value)];
	});

	const respond = (
		requestId: string,
		replies: QuestionReply[],
	): QuestionAnswerRecord[] | null => {
		const target = queue.value.find((req) => req.requestId === requestId);
		if (target === undefined) return null;
		if (!options.send(responseMessage(target, replies))) return null;
		drop(requestId);
		return toAnswerRecords(target.questions, replies);
	};

	return { queue, respond, clear: () => (queue.value = []) };
}
