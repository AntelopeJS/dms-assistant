import {
  Controller,
  Get,
  type HTTPResult,
  Parameter,
} from "@antelopejs/interface-api";
import { ROUTE_PREFIX } from "../constants/module";
import { SIDECAR_AUTH_HEADER } from "../constants/sidecar";
import { queryLogs } from "../logging/log-buffer";
import type { BufferedLog } from "../types/logs";
import { type QueryValue, queryText } from "./query-text";
import { isSidecarRequest, sidecarForbidden } from "./sidecar-auth";

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class AILogsController extends Controller(ROUTE_PREFIX) {
  @Get("/logs")
  logs(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @Parameter("since", "query") since?: QueryValue,
    @Parameter("level", "query") level?: QueryValue,
    @Parameter("channel", "query") channel?: QueryValue,
    @Parameter("limit", "query") limit?: QueryValue,
  ): BufferedLog[] | HTTPResult {
    if (!isSidecarRequest(token)) return sidecarForbidden();
    return queryLogs({
      since: toNumber(queryText(since)),
      level: toNumber(queryText(level)),
      channel: queryText(channel) || undefined,
      limit: toNumber(queryText(limit)),
    });
  }
}
