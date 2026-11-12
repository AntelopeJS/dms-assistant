import { createHash } from "node:crypto";
import {
  Context,
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { z } from "zod";
import { listPageTables } from "../analyst/catalog";
import { dataRouteOf, routePath } from "../analyst/exclusions";
import type { AnalystTable } from "../analyst/layouts";
import { requestSessionId } from "../assistant/grants";
import { authorizeAssistantUser } from "../assistant/permission";
import { ROUTE_PREFIX } from "../constants/module";
import {
  analystExclusions,
  type StoredExclusion,
} from "../db/analyst-exclusion";

const EXCLUSIONS_PATH = "/exclusions";
const ID_HASH = "sha256";
const ID_ENCODING = "hex";
const HTTP_BAD_REQUEST = 400;
const I18N_KEY_MARK = "$";
const COVERS_SEPARATOR = ", ";

const SavedExclusionSchema = z.object({
  route: z.string().trim().min(1),
  fields: z.array(z.string().trim().min(1)),
});

type VisiblePages = Awaited<ReturnType<typeof listPageTables>>;

/** One field of a data route, as the route's checklist lists it. */
interface RouteField {
  field: string;
  header: string;
  isExcluded: boolean;
  /** A table the owner can see shows it: else it is excluded and stale. */
  isShown: boolean;
}

/** A route's entry id: the same for one route on every replica. */
function exclusionId(route: string): string {
  return createHash(ID_HASH).update(route).digest(ID_ENCODING);
}

/** A name to show as it is: a translation key is no name, so the fallback is. */
function plain(label: string | undefined, fallback: string): string {
  return label === undefined || label.startsWith(I18N_KEY_MARK)
    ? fallback
    : label;
}

async function visiblePages(
  ctx: RequestContext,
  user: User,
): Promise<VisiblePages> {
  const { tenantId } = await authorizeAssistantUser(ctx, user);
  return listPageTables({
    userId: user._id,
    tenantId,
    sessionId: requestSessionId(ctx),
  });
}

function coverage(pages: VisiblePages, route: string): string[] {
  const covers = pages.flatMap(({ page, tables }) =>
    tables
      .filter((table) => dataRouteOf(table) === route)
      .map(
        (table) =>
          `${plain(page.title, page.path)} › ${plain(table.caption, table.id)}`,
      ),
  );
  return [...new Set(covers)];
}

function shownFields(pages: VisiblePages): Map<string, Map<string, string>> {
  const byRoute = new Map<string, Map<string, string>>();
  const tables: AnalystTable[] = pages.flatMap(({ tables }) => tables);
  for (const table of tables) {
    const route = dataRouteOf(table);
    const fields = byRoute.get(route) ?? new Map<string, string>();
    for (const { field, header } of table.columns) {
      if (!fields.has(field)) fields.set(field, plain(header, field));
    }
    byRoute.set(route, fields);
  }
  return byRoute;
}

/**
 * Every route the owner can see or has an entry for, each with the columns
 * of every table reading it, merged, and its excluded fields, a stale one
 * included.
 */
function routeChecklists(pages: VisiblePages, entries: StoredExclusion[]) {
  const shown = shownFields(pages);
  const excluded = new Map(entries.map((e) => [e.route, new Set(e.fields)]));
  const routes = new Set([...shown.keys(), ...excluded.keys()]);
  return [...routes].map((route) => {
    const headers = shown.get(route) ?? new Map<string, string>();
    const fields = excluded.get(route) ?? new Set<string>();
    const listed: RouteField[] = [...headers].map(([field, header]) => ({
      field,
      header,
      isExcluded: fields.has(field),
      isShown: true,
    }));
    for (const field of fields) {
      if (headers.has(field)) continue;
      listed.push({ field, header: field, isExcluded: true, isShown: false });
    }
    return { route, fields: listed };
  });
}

/**
 * The owner's list of what Analyst may never read, one entry per data route,
 * and what they can pick from. An entry stays listed, and enforced, when
 * nothing they can see shows its route or a field any more.
 */
@AuthOwnerOnly()
export class AIExclusionsController extends Controller(ROUTE_PREFIX) {
  @Get(EXCLUSIONS_PATH)
  async list(@Context() ctx: RequestContext, @AuthUser() user: User) {
    const [entries, pages] = await Promise.all([
      analystExclusions().getAll(),
      visiblePages(ctx, user),
    ]);
    const results = entries.map(({ _id, route, fields }) => {
      const covers = coverage(pages, route);
      return {
        _id,
        route,
        fields: [...fields].sort(),
        covers: covers.join(COVERS_SEPARATOR),
        status: covers.length > 0 ? "active" : "not_found",
      };
    });
    return { results, total: results.length };
  }

  @Get(`${EXCLUSIONS_PATH}/candidates`)
  async candidates(@Context() ctx: RequestContext, @AuthUser() user: User) {
    const [entries, pages] = await Promise.all([
      analystExclusions().getAll(),
      visiblePages(ctx, user),
    ]);
    return {
      pages: pages
        .filter(({ tables }) => tables.length > 0)
        .map(({ page, tables }) => ({
          path: page.path,
          title: plain(page.title, page.path),
          tables: tables.map((table) => ({
            id: table.id,
            title: plain(table.caption, table.id),
            route: dataRouteOf(table),
          })),
        })),
      routes: routeChecklists(pages, entries),
    };
  }

  /**
   * Sets the fields excluded on a route, its entry made, replaced, or removed
   * when no field is left.
   */
  @Put(EXCLUSIONS_PATH)
  async save(@JSONBody() body?: unknown) {
    const parsed = SavedExclusionSchema.safeParse(body);
    if (!parsed.success) {
      return new HTTPResult(HTTP_BAD_REQUEST, {
        message: "An exclusion needs a route and its list of fields.",
      });
    }
    const route = routePath(parsed.data.route);
    const fields = [...new Set(parsed.data.fields)];
    const id = exclusionId(route);
    const store = analystExclusions();
    if (fields.length === 0) {
      await store.delete(id);
      return { route, fields };
    }
    if ((await store.update(id, { fields })) > 0) {
      return { _id: id, route, fields };
    }
    try {
      await store.insert({ _id: id, route, fields });
    } catch (err) {
      if ((await store.get(id)) === undefined) throw err;
      await store.update(id, { fields });
    }
    return { _id: id, route, fields };
  }

  @Delete(`${EXCLUSIONS_PATH}/:id`)
  async remove(@Parameter("id", "param") id: string) {
    await analystExclusions().delete(id);
    return { isRemoved: true };
  }
}
