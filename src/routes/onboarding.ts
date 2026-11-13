import {
  Controller,
  Get,
  type HTTPBody,
  HTTPResult,
  JSONBody,
  Post,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { z } from "zod";
import { HTTP_STATUS } from "../constants/http";
import { ROUTE_PREFIX } from "../constants/module";
import { relay } from "./sidecar-results";

const ONBOARDING_PATH = "/onboarding";
const CLAUDE_TOKEN_PATH = `${ONBOARDING_PATH}/claude-token`;
const PROVIDER_PATH = `${ONBOARDING_PATH}/provider`;
const NO_STORE = { "Cache-Control": "no-store" };

const ProviderNameSchema = z.enum(["claude", "codex"]);

const ProviderLoginSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("signed-out") }),
  z.object({
    status: z.literal("signed-in"),
    source: z.enum(["env", "saved", "claude-cli", "chatgpt"]),
    email: z.string().optional(),
    plan: z.string().optional(),
  }),
  z.object({
    status: z.literal("expired"),
    source: z.enum(["env", "saved", "claude-cli", "chatgpt"]),
    email: z.string().optional(),
  }),
]);

/** What the first-run popup reads: see `GET /onboarding` in the sidecar. */
const OnboardingStateSchema = z.object({
  bootId: z.string().min(1),
  provider: ProviderNameSchema,
  logins: z.object({
    claude: ProviderLoginSchema,
    codex: ProviderLoginSchema,
  }),
  codexLoginUrl: z.string().optional(),
});

/** The answer to a pasted token. It never carries the token. */
const ClaudeTokenCheckSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    email: z.string().optional(),
    plan: z.string().optional(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["rejected", "unreachable", "malformed", "unsaved"]),
  }),
]);

const ClaudeTokenBodySchema = z.object({ token: z.string() });
const ProviderBodySchema = z.object({ provider: ProviderNameSchema });

type OnboardingState = z.infer<typeof OnboardingStateSchema>;
type ClaudeTokenCheck = z.infer<typeof ClaudeTokenCheckSchema>;

function noStore(answer: HTTPResult | HTTPBody): HTTPResult {
  return HTTPResult.withHeaders(answer, NO_STORE);
}

function invalid(message: string): HTTPResult {
  return noStore(new HTTPResult(HTTP_STATUS.BAD_REQUEST, { message }));
}

/**
 * The first-run popup's routes, relayed to the sidecar: where the assistant's
 * logins stand, a pasted Claude token (checked live, then saved), and the
 * provider the assistant runs on. Answers are never cached, and none carries
 * a token.
 */
@AuthOwnerOnly()
export class AIOnboardingController extends Controller(ROUTE_PREFIX) {
  @Get(ONBOARDING_PATH)
  async state(): Promise<HTTPResult> {
    return noStore(
      await relay<OnboardingState, OnboardingState>(
        ONBOARDING_PATH,
        OnboardingStateSchema,
        (state) => state,
      ),
    );
  }

  @Post(CLAUDE_TOKEN_PATH)
  async claudeToken(@JSONBody() body?: unknown): Promise<HTTPResult> {
    const parsed = ClaudeTokenBodySchema.safeParse(body);
    if (!parsed.success) return invalid("Missing token.");
    return noStore(
      await relay<ClaudeTokenCheck, ClaudeTokenCheck>(
        CLAUDE_TOKEN_PATH,
        ClaudeTokenCheckSchema,
        (check) => check,
        { method: "POST", body: parsed.data },
      ),
    );
  }

  @Post(PROVIDER_PATH)
  async provider(@JSONBody() body?: unknown): Promise<HTTPResult> {
    const parsed = ProviderBodySchema.safeParse(body);
    if (!parsed.success) return invalid("Unknown provider.");
    return noStore(
      await relay<OnboardingState, OnboardingState>(
        PROVIDER_PATH,
        OnboardingStateSchema,
        (state) => state,
        { method: "POST", body: parsed.data },
      ),
    );
  }
}
