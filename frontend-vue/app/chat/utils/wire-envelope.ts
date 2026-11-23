import { z } from "zod";

/**
 * What every sidecar event carries: its type, and the conversation it belongs
 * to when it belongs to one. A conversation id that is not text reads as none.
 */
export const WIRE_ENVELOPE_SCHEMA = z.looseObject({
	type: z.string(),
	conversationId: z.string().optional().catch(undefined),
});

export type WireEnvelope = z.infer<typeof WIRE_ENVELOPE_SCHEMA>;

/** The envelope of a message from the stream, `null` for one without a type. */
export function readEnvelope(message: unknown): WireEnvelope | null {
	const parsed = WIRE_ENVELOPE_SCHEMA.safeParse(message);
	return parsed.success ? parsed.data : null;
}

/** Whether an event concerns the active conversation: those of no chat do too. */
export function isForConversation(
	envelope: WireEnvelope,
	activeId: string,
): boolean {
	return (
		envelope.conversationId === undefined ||
		envelope.conversationId === activeId
	);
}

/** An event as its handler reads it, `null` when the sidecar sent another shape. */
export function parseEvent<Event>(
	schema: z.ZodType<Event>,
	envelope: WireEnvelope,
): Event | null {
	const parsed = schema.safeParse(envelope);
	return parsed.success ? parsed.data : null;
}
