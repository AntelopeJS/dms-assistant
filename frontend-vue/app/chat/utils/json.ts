import { z } from "zod";
import type { JsonObject, JsonValue } from "../types/json";

/** Parses any value `JSON.parse` can produce. */
export const JSON_VALUE_SCHEMA: z.ZodType<JsonValue> = z.json();

const JSON_OBJECT_SCHEMA: z.ZodType<JsonObject> = z.record(
	z.string(),
	JSON_VALUE_SCHEMA,
);
const TEXT_SCHEMA = z.string();
const TEXT_OR_NUMBER_SCHEMA = z.union([z.string(), z.number()]);

/** The object a value is, an empty one for anything else (list, text, null). */
export function toJsonObject(value: JsonValue | undefined): JsonObject {
	const parsed = JSON_OBJECT_SCHEMA.safeParse(value);
	return parsed.success ? parsed.data : {};
}

/** The text a value is, `null` for anything else. */
export function toText(value: JsonValue | undefined): string | null {
	const parsed = TEXT_SCHEMA.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** The text of a text or a number, `null` for anything else. */
export function toTextOrNumber(value: JsonValue | undefined): string | null {
	const parsed = TEXT_OR_NUMBER_SCHEMA.safeParse(value);
	return parsed.success ? String(parsed.data) : null;
}

/** The member of an object of its own, never one it inherits. */
export function ownMember(
	object: JsonObject,
	key: string,
): JsonValue | undefined {
	return Object.hasOwn(object, key) ? object[key] : undefined;
}
