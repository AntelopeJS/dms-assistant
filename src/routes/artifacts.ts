import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ROUTE_PREFIX } from "../constants/module";
import { buildQuery, pathSegment, type QueryParams } from "../sidecar";
import type {
  ArtifactPayload,
  ArtifactSummary,
  ArtifactTableRow,
  SidecarList,
} from "../types";
import { sidecarListParams } from "./list-query";
import { relay } from "./sidecar-results";
import { ARTIFACT_ANSWER, ARTIFACT_PAGE_ANSWER } from "./sidecar-answers";

const ARTIFACTS_PATH = "/artifacts";
/** The conversation filter the chat sends, forwarded as it is. */
const CONVERSATION_PARAM = "conversationId";

/** The table's list query, the conversation filter and the viewer, for the sidecar. */
function artifactsParams(search: URLSearchParams, viewer: User): QueryParams {
  return {
    ...sidecarListParams(search),
    [CONVERSATION_PARAM]: search.get(CONVERSATION_PARAM) ?? undefined,
    viewer: viewer._id,
  };
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
 * The artifacts the assistant saved: the list the Artifacts page shows and
 * one artifact with its data. Every read names the signed-in user as the
 * viewer, so the sidecar answers the artifacts of their own conversations
 * alone, as it does for the conversation list.
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
    const query = buildQuery({ viewer: user._id });
    return relay(
      `${ARTIFACTS_PATH}/${pathSegment(id)}${query}`,
      ARTIFACT_ANSWER,
      (artifact) => artifact,
    );
  }
}
