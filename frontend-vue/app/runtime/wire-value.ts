/**
 * What the dashboard's authenticated fetch resolves to: the decoded JSON, or
 * nothing for an empty answer. Nothing has checked its shape yet; the reader
 * parses it with a schema.
 */
export type WireValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| WireValue[]
	| { [key: string]: WireValue };
