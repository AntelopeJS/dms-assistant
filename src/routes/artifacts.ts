import {
  Context,
  Controller,
  Delete,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { z } from "zod";
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
  ArtifactPayload,
  ArtifactSummary,
  ArtifactTableRow,
  SidecarList,
} from "../types";
import { deleteConfirmDialog } from "./artifact-confirm";
import { type FilterMappings, sidecarListParams } from "./list-query";
import { asIs, relay } from "./sidecar-results";
import {
  ANY_ANSWER,
  ARTIFACT_ANSWER,
  ARTIFACT_PAGE_ANSWER,
} from "./sidecar-answers";

const ARTIFACTS_PATH = "/artifacts";
/** The conversation filter the chat sends, forwarded as it is. */
const CONVERSATION_PARAM = "conversationId";

/** The kind filter of the Artifacts page, a column filter the sidecar reads under the same name. */
const FILTERS: FilterMappings = {
  kind: { param: "kind" },
};

/** The table's list query, the conversation filter and the viewer, for the sidecar. */
function artifactsParams(search: URLSearchParams, viewer: User): QueryParams {
  return {
    ...sidecarListParams(search, FILTERS),
    [CONVERSATION_PARAM]: search.get(CONVERSATION_PARAM) ?? undefined,
    viewer: viewer._id,
  };
}

function artifactPath(id: string, viewer: User, action = ""): string {
  const suffix = action ? `/${action}` : "";
  const query = buildQuery({ viewer: viewer._id });
  return `${ARTIFACTS_PATH}/${pathSegment(id)}${suffix}${query}`;
}

function tableRow(artifact: ArtifactSummary): ArtifactTableRow {
  return {
    ...artifact,
    _id: artifact.id,
    createdAt: new Date(artifact.createdAtMs).toISOString(),
  };
}

function tablePage(
  page: SidecarList<ArtifactSummary>,
): SidecarList<ArtifactTableRow> {
  return { results: page.results.map(tableRow), total: page.total };
}

/**
 * The artifacts the assistant saved: the list the Artifacts page shows, one
 * artifact with its data, the dialog Delete asks in and Delete itself. Every
 * read names the signed-in user as the viewer, so the sidecar answers the
 * artifacts of their own conversations alone, as it does for the
 * conversation list, and deletes nothing it would not show them.
 */
@AuthOwnerOnly()
export class AIArtifactsController extends Controller(ROUTE_PREFIX) {
  @Get(ARTIFACTS_PATH)
  list(
    @Context() ctx: RequestContext,
    @AuthRawUser() user: User,
  ): Promise<SidecarList<ArtifactTableRow> | HTTPResult> {
    const query = buildQuery(artifactsParams(ctx.url.searchParams, user));
    return relay(`${ARTIFACTS_PATH}${query}`, ARTIFACT_PAGE_ANSWER, tablePage);
  }

  @Get(`${ARTIFACTS_PATH}/:id`)
  detail(
    @Parameter("id", "param") id: string,
    @AuthRawUser() user: User,
  ): Promise<ArtifactPayload | HTTPResult> {
    return relay(
      artifactPath(id, user),
      ARTIFACT_ANSWER,
      (artifact) => artifact,
    );
  }

  /** The dialog Delete asks in, worded from the artifact's title; an artifact the user may not see answers 404 here too. */
  @Get(`${ARTIFACTS_PATH}/:id/delete-confirm`)
  deleteConfirm(
    @Parameter("id", "param") id: string,
    @AuthRawUser() user: User,
  ): Promise<ConfirmDialogSerialized | HTTPResult> {
    return relay(artifactPath(id, user), ARTIFACT_ANSWER, (artifact) =>
      deleteConfirmDialog({ title: titleOf(artifact) }),
    );
  }

  @Delete(`${ARTIFACTS_PATH}/:id`)
  remove(
    @Parameter("id", "param") id: string,
    @AuthRawUser() user: User,
  ): Promise<JsonBody | HTTPResult | undefined> {
    return relay(artifactPath(id, user), ANY_ANSWER, asIs, {
      method: "DELETE",
    });
  }
}

/** The one member of the spec the dialog reads: its title. */
const TITLED_SPEC = z.looseObject({ title: z.string() });

/** The artifact's title as its spec names it, read without the spec schema: a text, else nothing. */
function titleOf(artifact: ArtifactPayload): string {
  const titled = TITLED_SPEC.safeParse(artifact.spec);
  return titled.success ? titled.data.title : "";
}
