import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { HTTP_STATUS } from "../constants/http.js";
import { readClaudeLogin } from "../providers/claude/login.js";
import { submitClaudeToken } from "../providers/claude/token-check.js";
import { readAccountStatus } from "../providers/codex/chatgpt/credentials.js";
import { createLoginUrl } from "../providers/codex/chatgpt/login.js";
import type { ProviderLogin } from "../providers/login.js";
import { mergeSettings } from "../state/settings-store.js";
import { PROVIDER_NAMES, type ProviderName } from "../state/types.js";
import { readBody, sendJson } from "./http-io.js";
import type { ApiDeps, ApiRoute } from "./http-routes.js";

/**
 * Random per sidecar process, so the frontend can open the popup once per
 * start.
 */
const BOOT_ID = randomUUID();

/** What `GET /onboarding` answers: where the assistant stands before its first turn. */
interface OnboardingState {
  bootId: string;
  provider: ProviderName;
  logins: Record<ProviderName, ProviderLogin>;
  /** OpenAI's authorize URL for a new attempt, present while Codex is signed out. */
  codexLoginUrl?: string;
}

const ClaudeTokenBodySchema = z.object({ token: z.string() });
const ProviderBodySchema = z.object({ provider: z.enum(PROVIDER_NAMES) });

/**
 * A ChatGPT sign-in never reports `expired`: the store refreshes it on use and
 * forgets one that can no longer be refreshed, which reads as signed out.
 */
function codexLogin(): ProviderLogin {
  const account = readAccountStatus();
  if (!account.isSignedIn) return { status: "signed-out" };
  return { status: "signed-in", source: "chatgpt", email: account.email };
}

async function buildOnboardingState(deps: ApiDeps): Promise<OnboardingState> {
  const codex = codexLogin();
  return {
    bootId: BOOT_ID,
    provider: deps.settingsStore.get().provider,
    logins: { claude: readClaudeLogin(), codex },
    codexLoginUrl:
      codex.status === "signed-out"
        ? await createLoginUrl(deps.port)
        : undefined,
  };
}

function parseBody<T extends z.ZodType>(schema: T, body: string) {
  try {
    return schema.safeParse(JSON.parse(body));
  } catch {
    return schema.safeParse(null);
  }
}

async function postClaudeToken(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = parseBody(ClaudeTokenBodySchema, await readBody(req));
  if (!body.success) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, { message: "Missing token." });
    return;
  }
  sendJson(res, HTTP_STATUS.OK, await submitClaudeToken(body.data.token));
}

async function postProvider(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
): Promise<void> {
  const body = parseBody(ProviderBodySchema, await readBody(req));
  if (!body.success) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, { message: "Unknown provider." });
    return;
  }
  const next = mergeSettings(deps.settingsStore.get(), {
    provider: body.data.provider,
  });
  deps.settingsApplier.apply(next);
  sendJson(res, HTTP_STATUS.OK, await buildOnboardingState(deps));
}

/**
 * The first-run popup's routes: the state it reads, the Claude token it
 * submits, and the provider it picks. No answer carries a token.
 */
export const ONBOARDING_ROUTES: readonly ApiRoute[] = [
  {
    method: "GET",
    pattern: /^\/onboarding$/,
    handle: async (_req, res, deps) =>
      sendJson(res, HTTP_STATUS.OK, await buildOnboardingState(deps)),
  },
  {
    method: "POST",
    pattern: /^\/onboarding\/claude-token$/,
    handle: postClaudeToken,
  },
  {
    method: "POST",
    pattern: /^\/onboarding\/provider$/,
    handle: postProvider,
  },
];
