import {
  Context,
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { ConfirmDialogSerialized } from "@antelopejs/interface-dms/base";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ROUTE_PREFIX } from "../constants/module";
import {
  buildQuery,
  type JsonBody,
  pathSegment,
  type QueryParams,
} from "../sidecar";
import type {
  ChangeSetSummary,
  ChangeSetTableRow,
  SidecarList,
} from "../types";
import { actorName } from "./actor";
import { type FilterMappings, sidecarListParams } from "./list-query";
import { asIs, relay } from "./sidecar-results";
import {
  ANY_ANSWER,
  CHANGE_SET_PAGE_ANSWER,
  UNDO_PREVIEW_ANSWER,
} from "./sidecar-answers";
import { INCLUDE_LATER_FIELD, undoConfirmDialog } from "./undo-confirm";

const CHANGES_PATH = "/changes";
const UNDONE_STATE = "undone";

const FILTERS: FilterMappings = {
  scope: { param: "scope" },
  state: { param: "state" },
};
/** Parameters the Changes view sends as they are, beside the table's filters. */
const DIRECT_PARAMS = Object.keys(FILTERS);

function changesParams(search: URLSearchParams): QueryParams {
  const direct: QueryParams = Object.fromEntries(
    DIRECT_PARAMS.map((name) => [name, search.get(name) ?? undefined]),
  );
  return { ...direct, ...sidecarListParams(search, FILTERS) };
}

/** What Undo may send: the dialog's choice to undo later sets too. */
interface UndoBody {
  [INCLUDE_LATER_FIELD]?: boolean;
}

function changeSetPath(id: string, action = ""): string {
  const suffix = action ? `/${action}` : "";
  return `${CHANGES_PATH}/${pathSegment(id)}${suffix}`;
}

function tableRow(changeSet: ChangeSetSummary): ChangeSetTableRow {
  const isUndone = changeSet.state === UNDONE_STATE;
  return {
    ...changeSet,
    _id: changeSet.id,
    createdAt: new Date(changeSet.createdAtMs).toISOString(),
    filesCount: changeSet.files.length,
    diffstat: `${changeSet.files.length} · +${changeSet.added} −${changeSet.removed}`,
    stateDetail: isUndone ? changeSet.stateChangedBy : undefined,
  };
}

function tablePage(
  page: SidecarList<ChangeSetSummary>,
): SidecarList<ChangeSetTableRow> {
  return { results: page.results.map(tableRow), total: page.total };
}

/**
 * Change sets: the Changes page's source table, a set's detail and Undo preview, the dialog Undo asks in, and Undo / Redo stamped with
 * the signed-in user.
 */
@AuthOwnerOnly()
export class AIChangesController extends Controller(ROUTE_PREFIX) {
  @Get(CHANGES_PATH)
  list(
    @Context() ctx: RequestContext,
  ): Promise<SidecarList<ChangeSetTableRow> | HTTPResult> {
    const query = buildQuery(changesParams(ctx.url.searchParams));
    return relay(`${CHANGES_PATH}${query}`, CHANGE_SET_PAGE_ANSWER, tablePage);
  }

  @Get(`${CHANGES_PATH}/:id`)
  detail(
    @Parameter("id", "param") id: string,
  ): Promise<JsonBody | HTTPResult | undefined> {
    return relay(changeSetPath(id), ANY_ANSWER, asIs);
  }

  @Get(`${CHANGES_PATH}/:id/undo-preview`)
  undoPreview(
    @Parameter("id", "param") id: string,
  ): Promise<JsonBody | HTTPResult | undefined> {
    return relay(changeSetPath(id, "undo-preview"), ANY_ANSWER, asIs);
  }

  @Get(`${CHANGES_PATH}/:id/undo-confirm`)
  undoConfirm(
    @Parameter("id", "param") id: string,
  ): Promise<ConfirmDialogSerialized | HTTPResult> {
    return relay(
      changeSetPath(id, "undo-preview"),
      UNDO_PREVIEW_ANSWER,
      undoConfirmDialog,
    );
  }

  @Post(`${CHANGES_PATH}/:id/undo`)
  undo(
    @Parameter("id", "param") id: string,
    @AuthRawUser() user: User,
    @JSONBody() body?: UndoBody,
  ): Promise<JsonBody | HTTPResult | undefined> {
    return relay(changeSetPath(id, "undo"), ANY_ANSWER, asIs, {
      method: "POST",
      body: {
        includeLater: body?.[INCLUDE_LATER_FIELD] === true,
        actor: actorName(user),
      },
    });
  }

  @Post(`${CHANGES_PATH}/:id/redo`)
  redo(
    @Parameter("id", "param") id: string,
    @AuthRawUser() user: User,
  ): Promise<JsonBody | HTTPResult | undefined> {
    return relay(changeSetPath(id, "redo"), ANY_ANSWER, asIs, {
      method: "POST",
      body: { actor: actorName(user) },
    });
  }
}
