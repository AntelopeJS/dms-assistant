import type { WireValue } from "./wire-value";

/**
 * A message of the tab's stream: a JSON object named by its `type`. The
 * receiver reads the other fields with a schema of its own.
 */
export interface TypedMessage {
	type: string;
	[field: string]: WireValue;
}

/** A message this tab sends on the stream; the sidecar reads it by its `type`. */
export interface OutgoingMessage {
	readonly type: string;
}

/** Whether `value` is an object carrying a string `type`, as every protocol message does. */
export function isTypedMessage(value: unknown): value is TypedMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}
