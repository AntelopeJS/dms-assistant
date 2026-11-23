export interface TypedMessage {
	type: string;
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
