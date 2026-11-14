import { z } from "zod";

const TextSchema = z.string().optional().catch(undefined);

/** A query parameter as `@Parameter(name, "query")` hands it over: `?name` alone and `?name=` give `true`. */
export type QueryValue = string | true | undefined;

/** The parameter's text, or `undefined` when the request carries none. */
export function queryText(value: QueryValue): string | undefined {
  return TextSchema.parse(value);
}
