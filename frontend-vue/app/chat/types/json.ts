/** Any value `JSON.parse` can produce. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonArray
	| JsonObject;

/** A JSON list. */
export type JsonArray = JsonValue[];

/** A JSON object: a tool's arguments and a held call's preview arrive as one. */
export interface JsonObject {
	[key: string]: JsonValue;
}
