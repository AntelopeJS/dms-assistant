import { Controller, Get, HTTPResult, Post } from "@antelopejs/interface-api";
import { z } from "zod";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ROUTE_PREFIX } from "../constants/module";
import {
  hasSidecarGivenUp,
  isSidecarDisabled,
  isSidecarRunning,
  restartSidecar,
} from "../lifecycle/spawn-sidecar";
import { buildQuery, requestSidecar } from "../sidecar";
import type { AssistantStatus } from "../types";
import type { JsonBody } from "../sidecar/json-body";
import { bannerAnswer } from "./banner";
import { assistantUnavailable } from "./sidecar-results";
import { OFFLINE_STATUS, statusBanner } from "./status-shapes";

const STATUS_PATH = "/status";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * What the sidecar says of itself, its fields in the order it writes them so
 * the answer keeps that order; the ones it adds beyond `AssistantStatus` pass.
 */
const SidecarStatus = z.looseObject({
  status: z.string(),
  provider: z.string().optional(),
  providers: z.unknown().optional(),
  builderAvailable: z.boolean().optional(),
  mode: z.string().optional(),
  generationMode: z.string().optional(),
  workingConversations: z.number().optional(),
  pendingApprovals: z.number().optional(),
  pendingQuestions: z.number().optional(),
  port: z.number().optional(),
  version: z.string().optional(),
  lastError: z.string().optional(),
  checkpointsAvailable: z.boolean().optional(),
});

/** What the backend knows of the sidecar process, beside what it says itself. */
interface ProcessState {
  isRunning: boolean;
  hasGivenUp: boolean;
  disabled: boolean;
}

async function processState(): Promise<ProcessState> {
  return {
    isRunning: isSidecarRunning(),
    hasGivenUp: hasSidecarGivenUp(),
    disabled: await isSidecarDisabled(),
  };
}

/**
 * The sidecar's own status of the conversations `viewer` may see, so its
 * counts agree with the list their chat shows, or `{ status: "offline" }` when
 * it does not answer, both with the process state: the chat and the Settings
 * banner always have something to draw, and knows whether a restart can help.
 */
async function readStatus(viewer: User): Promise<AssistantStatus> {
  const path = `${STATUS_PATH}${buildQuery({ viewer: viewer._id })}`;
  try {
    const response = await requestSidecar(path);
    const reported = SidecarStatus.safeParse(response.body);
    if (!response.isOk || !reported.success) {
      return { status: OFFLINE_STATUS, ...(await processState()) };
    }
    return { ...reported.data, ...(await processState()) };
  } catch {
    return { status: OFFLINE_STATUS, ...(await processState()) };
  }
}

/** What the status routes answer: the status, its rows, or its banner. */
type StatusAnswer = AssistantStatus | JsonBody | HTTPResult;

function fresh(body: StatusAnswer): HTTPResult {
  return HTTPResult.withHeaders(body, NO_STORE);
}

/**
 * The assistant's live status, the Settings banner drawn from it, and the way
 * to restart it.
 */
@AuthOwnerOnly()
export class AIStatusController extends Controller(ROUTE_PREFIX) {
  @Get(STATUS_PATH)
  async status(@AuthRawUser() user: User): Promise<HTTPResult> {
    return fresh(await readStatus(user));
  }

  @Get(`${STATUS_PATH}/banner`)
  async banner(@AuthRawUser() user: User): Promise<HTTPResult> {
    return fresh(bannerAnswer(statusBanner(await readStatus(user))));
  }

  @Post("/sidecar/restart")
  async restart(@AuthRawUser() user: User): Promise<HTTPResult> {
    try {
      await restartSidecar();
    } catch {
      return assistantUnavailable();
    }
    return fresh(await readStatus(user));
  }
}
