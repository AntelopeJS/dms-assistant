/** The AI an assistant conversation runs on. */
export type ProviderName = "claude" | "codex";

/** Where a working login comes from. `env` always wins and cannot be changed from the UI. */
export type LoginSource = "env" | "saved" | "claude-cli" | "chatgpt";

/** One provider's login as the sidecar sees it. */
export type ProviderLogin =
	| { status: "signed-out" }
	| { status: "signed-in"; source: LoginSource; email?: string; plan?: string }
	| { status: "expired"; source: LoginSource; email?: string };

/** `GET /ai/onboarding`. */
export interface OnboardingState {
	/** Random per sidecar or server start, so the popup opens once per start. */
	bootId: string;
	/** The provider the assistant runs on. */
	provider: ProviderName;
	logins: Record<ProviderName, ProviderLogin>;
	/** OpenAI's authorize URL for a new sign-in attempt, while Codex is signed out. */
	codexLoginUrl?: string;
}

/** Why a pasted Claude token does not work. */
export type ClaudeTokenProblem = "rejected" | "unreachable" | "malformed";

/** `POST /ai/onboarding/claude-token`: the token, checked live against Anthropic and saved when it works. */
export type ClaudeTokenCheck =
	| { ok: true; email?: string; plan?: string }
	| { ok: false; reason: ClaudeTokenProblem };

/** The backend's onboarding routes, owner-only, under the module's `/ai` prefix. */
export const ONBOARDING_PATH = "/ai/onboarding";
export const CLAUDE_TOKEN_PATH = `${ONBOARDING_PATH}/claude-token`;
export const PROVIDER_PATH = `${ONBOARDING_PATH}/provider`;
/** Completes a ChatGPT sign-in from the address a remote browser could not load. */
export const CODEX_CALLBACK_PATH = "/ai/codex/callback";

export const PROVIDERS: readonly ProviderName[] = ["claude", "codex"];
