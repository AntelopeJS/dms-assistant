import { Logging } from "@antelopejs/interface-core/logging";
import { z } from "zod";
import { analystExclusions } from "../db/analyst-exclusion";
import type { AnalystColumn, AnalystTable } from "./layouts";
import { AnalystRefusal } from "./refusal";

const HTTP_SERVICE_UNAVAILABLE = 503;
const QUERY_MARK = "?";

/** The excluded fields of each data route. */
export type ExcludedFields = ReadonlyMap<string, ReadonlySet<string>>;

/** A route as an exclusion names it: its path, without a query string. */
export function routePath(route: string): string {
  const mark = route.indexOf(QUERY_MARK);
  return mark === -1 ? route : route.slice(0, mark);
}

/** The data route a table reads: a source table's `fetchUrl`, else its location. */
export function dataRouteOf(table: AnalystTable): string {
  return routePath(table.source?.fetchUrl ?? table.location);
}

const EntriesSchema = z.array(
  z.object({ route: z.string(), fields: z.array(z.string()) }),
);

function indexed(entries: z.infer<typeof EntriesSchema>): ExcludedFields {
  const byRoute = new Map<string, Set<string>>();
  for (const { route, fields } of entries) {
    const excluded = byRoute.get(route) ?? new Set<string>();
    for (const field of fields) excluded.add(field);
    byRoute.set(route, excluded);
  }
  return byRoute;
}

/**
 * The project's exclusion list, read anew for every Analyst read so that a
 * change applies at once.
 *
 * @throws AnalystRefusal when the list cannot be read, or holds an entry
 * that is not a route and its fields: Analyst then reads
 * nothing rather than reading without it.
 */
export async function readExcludedFields(): Promise<ExcludedFields> {
  try {
    return indexed(EntriesSchema.parse(await analystExclusions().getAll()));
  } catch (err) {
    Logging.Error("[dms-ai] the Analyst exclusion list is unreadable:", err);
    throw new AnalystRefusal(
      HTTP_SERVICE_UNAVAILABLE,
      "exclusions_unavailable",
      "The project's exclusion list cannot be read, so no data can be read right now. Tell the user and do not guess the data.",
    );
  }
}

function redacted(column: AnalystColumn): AnalystColumn {
  return {
    field: column.field,
    header: column.header,
    type: column.type,
    sortable: false,
    filterModes: [],
    redacted: true,
  };
}

/**
 * A table as Analyst may know it: its excluded columns marked redacted, and
 * free-text search off when its route has any exclusion. A serialized table
 * only says whether it is searchable, not over which fields, so any exclusion
 * on its route may be one the search reaches.
 */
export function withExclusions(
  table: AnalystTable,
  excluded: ExcludedFields,
): AnalystTable {
  const fields = excluded.get(dataRouteOf(table));
  if (fields === undefined) return table;
  return {
    ...table,
    searchable: false,
    excludedFields: [...fields],
    columns: table.columns.map((column) =>
      fields.has(column.field) ? redacted(column) : column,
    ),
  };
}
