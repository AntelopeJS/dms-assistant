import type { ServerResponse } from "node:http";
import {
  type ArtifactRecord,
  isArtifactVisibleTo,
  summarizeArtifact,
} from "../artifacts/types.js";
import { UNKNOWN_ARTIFACT_MESSAGE } from "../constants/artifacts.js";
import { HTTP_STATUS } from "../constants/http.js";
import { sendJson } from "./http-io.js";
import { optionalParam, parseCount, parseLimit } from "./http-params.js";
import {
  type ApiDeps,
  type ApiRoute,
  type RouteMatch,
  VIEWER_PARAM,
} from "./http-routes.js";

/**
 * The artifacts the `viewer` query parameter's person may see, newest first;
 * a request naming nobody is read as a connection that named no actor, as
 * the conversation list reads it.
 */
function visibleArtifacts(deps: ApiDeps, match: RouteMatch): ArtifactRecord[] {
  const viewer = optionalParam(match.query, VIEWER_PARAM) ?? null;
  return (deps.services()?.artifacts.all() ?? [])
    .filter((record) => isArtifactVisibleTo(record, viewer))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** Whether the artifact's title or summary holds `search`, in any case. */
function matchesSearch(record: ArtifactRecord, search: string): boolean {
  const needle = search.toLowerCase();
  const { title, summary } = record.spec;
  return (
    title.toLowerCase().includes(needle) ||
    (summary?.toLowerCase().includes(needle) ?? false)
  );
}

/** The list the Artifacts page shows: summaries without their blocks, filtered on a conversation and a search. */
function listArtifactsRoute(
  res: ServerResponse,
  deps: ApiDeps,
  match: RouteMatch,
): void {
  const search = optionalParam(match.query, "search");
  const conversationId = optionalParam(match.query, "conversationId");
  const matching = visibleArtifacts(deps, match)
    .filter(
      (record) =>
        conversationId === undefined ||
        record.conversationId === conversationId,
    )
    .filter((record) => search === undefined || matchesSearch(record, search));
  const offset = parseCount(match.query, "offset", 0);
  const limit = parseLimit(match.query);
  sendJson(res, HTTP_STATUS.OK, {
    results: matching.slice(offset, offset + limit).map(summarizeArtifact),
    total: matching.length,
  });
}

/**
 * One artifact with its blocks. An artifact the viewer may not see answers as
 * an unknown one, so the sender cannot tell another person's artifact from
 * none.
 */
function artifactDetailRoute(
  res: ServerResponse,
  deps: ApiDeps,
  match: RouteMatch,
): void {
  const record = visibleArtifacts(deps, match).find(
    (candidate) => candidate.id === match.params[0],
  );
  if (record === undefined) {
    sendJson(res, HTTP_STATUS.NOT_FOUND, {
      message: UNKNOWN_ARTIFACT_MESSAGE,
    });
    return;
  }
  sendJson(res, HTTP_STATUS.OK, record);
}

/** The routes of the artifacts the conversations saved, read as the `viewer` the backend names. */
export const ARTIFACT_ROUTES: readonly ApiRoute[] = [
  {
    method: "GET",
    pattern: /^\/artifacts$/,
    handle: (_q, res, deps, m) => listArtifactsRoute(res, deps, m),
  },
  {
    method: "GET",
    pattern: /^\/artifacts\/([^/]+)$/,
    handle: (_q, res, deps, m) => artifactDetailRoute(res, deps, m),
  },
];
