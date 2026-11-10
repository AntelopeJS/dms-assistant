import {
  Context,
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
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
import { analystExclusions } from "../db/analyst-exclusion";

const EXCLUSIONS_PATH = "/exclusions";
const HTTP_BAD_REQUEST = 400;
const I18N_KEY_MARK = "$";
const COVERS_SEPARATOR = ", ";

const NewExclusionSchema = z.object({
  route: z.string().trim().min(1),
  field: z.string().trim().min(1),
});

type VisiblePages = Awaited<ReturnType<typeof listPageTables>>;

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

function tableReads(table: AnalystTable, route: string, field: string) {
  return (
    dataRouteOf(table) === route &&
    table.columns.some((column) => column.field === field)
  );
}

function coverage(pages: VisiblePages, route: string, field: string): string[] {
  return pages.flatMap(({ page, tables }) =>
    tables
      .filter((table) => tableReads(table, route, field))
      .map(
        (table) =>
          `${plain(page.title, page.path)} › ${plain(table.caption, table.id)}`,
      ),
  );
}

/**
 * The owner's list of what Analyst may never read, and the columns they can
 * pick from. An entry stays listed, and enforced, when nothing they can see
 * shows its route or field any more.
 */
@AuthOwnerOnly()
export class AIExclusionsController extends Controller(ROUTE_PREFIX) {
  @Get(EXCLUSIONS_PATH)
  async list(@Context() ctx: RequestContext, @AuthUser() user: User) {
    const [entries, pages] = await Promise.all([
      analystExclusions().getAll(),
      visiblePages(ctx, user),
    ]);
    const results = entries.map(({ _id, route, field }) => {
      const covers = coverage(pages, route, field);
      return {
        _id,
        route,
        field,
        covers: [...new Set(covers)].join(COVERS_SEPARATOR),
        status: covers.length > 0 ? "active" : "not_found",
      };
    });
    return { results, total: results.length };
  }

  @Get(`${EXCLUSIONS_PATH}/candidates`)
  async candidates(@Context() ctx: RequestContext, @AuthUser() user: User) {
    const pages = await visiblePages(ctx, user);
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
            columns: table.columns.map(({ field, header }) => ({
              field,
              header: plain(header, field),
            })),
          })),
        })),
    };
  }

  @Post(EXCLUSIONS_PATH)
  async add(@JSONBody() body?: unknown) {
    const parsed = NewExclusionSchema.safeParse(body);
    if (!parsed.success) {
      return new HTTPResult(HTTP_BAD_REQUEST, {
        message: "An exclusion needs a route and a field.",
      });
    }
    const route = routePath(parsed.data.route);
    const { field } = parsed.data;
    const model = analystExclusions();
    const entries = await model.getAll();
    const existing = entries.find(
      (entry) => entry.route === route && entry.field === field,
    );
    if (existing !== undefined) return { _id: existing._id, route, field };
    const [id] = await model.insert({ route, field });
    return { _id: id, route, field };
  }

  @Delete(`${EXCLUSIONS_PATH}/:id`)
  async remove(@Parameter("id", "param") id: string) {
    await analystExclusions().delete(id);
    return { isRemoved: true };
  }
}
