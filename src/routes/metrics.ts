import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import type { z } from "zod";
import {
  buildQuery,
  type QueryParams,
  readSidecar,
  USAGE_ANSWER,
} from "../sidecar";
import type { ChartPayload, KeyValueItem, UsageReport } from "../types";
import { usageChartPayload, usageSummaryPayload } from "./metric-shapes";
import { type QueryValue, queryText } from "./query-text";

const EMPTY_USAGE: UsageReport = { days: [], totalTokens: 0, conversations: 0 };

/** Reads a sidecar metric and turns it into a payload; an empty one while the sidecar is down. */
async function readMetric<T, R>(
  path: string,
  params: QueryParams,
  schema: z.ZodType<T>,
  fallback: T,
  toPayload: (body: T) => R,
): Promise<R> {
  return toPayload(
    await readSidecar(`${path}${buildQuery(params)}`, schema, fallback),
  );
}

/**
 * The figures of Settings › Usage. They render empty
 * rather than fail while the sidecar is down, so they never answer 503.
 */
@AuthOwnerOnly()
export class AIMetricsController extends Controller(`${ROUTE_PREFIX}/metrics`) {
  @Get("usage")
  usage(@Parameter("days", "query") days?: QueryValue): Promise<ChartPayload> {
    return readMetric(
      "/metrics/usage",
      { days: queryText(days) },
      USAGE_ANSWER,
      EMPTY_USAGE,
      usageChartPayload,
    );
  }

  @Get("usage/summary")
  usageSummary(
    @Parameter("days", "query") days?: QueryValue,
  ): Promise<{ items: KeyValueItem[] }> {
    return readMetric(
      "/metrics/usage",
      { days: queryText(days) },
      USAGE_ANSWER,
      EMPTY_USAGE,
      usageSummaryPayload,
    );
  }
}
