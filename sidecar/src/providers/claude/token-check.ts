import {
  CLAUDE_TOKEN_CHECK_HEADERS,
  CLAUDE_TOKEN_CHECK_MODEL,
  CLAUDE_TOKEN_CHECK_TIMEOUT_MS,
  CLAUDE_TOKEN_CHECK_URL,
  CLAUDE_TOKEN_PATTERN,
} from "../../constants/onboarding.js";
import { HTTP_STATUS } from "../../constants/http.js";
import { writeSavedClaudeToken } from "./credentials.js";

/** The answer to a pasted Claude token. It never carries the token. */
export type ClaudeTokenCheck =
  | { ok: true; email?: string; plan?: string }
  | { ok: false; reason: "rejected" | "unreachable" | "malformed" };

/** The part of `fetch` the check uses, so a test can stand in for Anthropic. */
export type TokenCheckFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number }>;

const REJECTED_STATUSES: readonly number[] = [
  HTTP_STATUS.UNAUTHORIZED,
  HTTP_STATUS.FORBIDDEN,
];

/**
 * Asks Anthropic whether the token works, without spending a turn: a token
 * count of one message. A token that is not shaped like one is refused without
 * a request. 401 and 403 mean Anthropic refused it; a network error, a timeout
 * or any other status means the check could not tell.
 */
export async function checkClaudeToken(
  token: string,
  send: TokenCheckFetch = fetch,
): Promise<ClaudeTokenCheck> {
  if (!CLAUDE_TOKEN_PATTERN.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  try {
    const response = await send(CLAUDE_TOKEN_CHECK_URL, {
      method: "POST",
      headers: {
        ...CLAUDE_TOKEN_CHECK_HEADERS,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_TOKEN_CHECK_MODEL,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(CLAUDE_TOKEN_CHECK_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    if (REJECTED_STATUSES.includes(response.status)) {
      return { ok: false, reason: "rejected" };
    }
    return { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** What `submitClaudeToken` calls out to; tests replace both. */
export interface ClaudeTokenSubmitDeps {
  check: (token: string) => Promise<ClaudeTokenCheck>;
  save: (saved: {
    token: string;
    email?: string;
    plan?: string;
  }) => Promise<void>;
}

const REAL_DEPS: ClaudeTokenSubmitDeps = {
  check: (token) => checkClaudeToken(token),
  save: writeSavedClaudeToken,
};

/** Checks a pasted token and saves it only when the check passes. */
export async function submitClaudeToken(
  pasted: string,
  deps: ClaudeTokenSubmitDeps = REAL_DEPS,
): Promise<ClaudeTokenCheck> {
  const token = pasted.trim();
  const result = await deps.check(token);
  if (!result.ok) return result;
  await deps.save({ token, email: result.email, plan: result.plan });
  return result;
}
