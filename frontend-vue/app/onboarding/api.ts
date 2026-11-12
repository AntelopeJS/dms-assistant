import {
	CLAUDE_TOKEN_PATH,
	type ClaudeTokenCheck,
	type ClaudeTokenProblem,
	CODEX_CALLBACK_PATH,
	type LoginSource,
	ONBOARDING_PATH,
	type OnboardingState,
	PROVIDER_PATH,
	type ProviderLogin,
	type ProviderName,
} from "./contract";

/** The dashboard's authenticated requests, as the assistant session hands them out. */
export interface OnboardingHttp {
	get: (path: string) => Promise<unknown>;
	post: (path: string, body: unknown) => Promise<unknown>;
}

export interface OnboardingApi {
	readState: () => Promise<OnboardingState>;
	/** Checks the token live against Anthropic; the backend saves it when it works. */
	checkClaudeToken: (token: string) => Promise<ClaudeTokenCheck>;
	setProvider: (provider: ProviderName) => Promise<OnboardingState>;
	/** Completes a ChatGPT sign-in from the address a remote browser could not load. */
	finishCodexSignIn: (url: string) => Promise<void>;
}

const SOURCES: ReadonlySet<string> = new Set<LoginSource>([
	"env",
	"saved",
	"claude-cli",
	"chatgpt",
]);
function isProblem(value: unknown): value is ClaudeTokenProblem {
	return (
		value === "rejected" || value === "unreachable" || value === "malformed"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function optionalText(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isProvider(value: unknown): value is ProviderName {
	return value === "claude" || value === "codex";
}

function isSource(value: unknown): value is LoginSource {
	return typeof value === "string" && SOURCES.has(value);
}

function parseLogin(value: unknown): ProviderLogin | null {
	if (!isRecord(value)) return null;
	if (value.status === "signed-out") return { status: "signed-out" };
	if (!isSource(value.source)) return null;
	const email = optionalText(value.email);
	if (value.status === "expired") {
		return { status: "expired", source: value.source, email };
	}
	if (value.status !== "signed-in") return null;
	return {
		status: "signed-in",
		source: value.source,
		email,
		plan: optionalText(value.plan),
	};
}

/** The backend's onboarding state, or an error naming what it answered instead. */
export function parseOnboardingState(value: unknown): OnboardingState {
	if (
		!isRecord(value) ||
		typeof value.bootId !== "string" ||
		!isProvider(value.provider) ||
		!isRecord(value.logins)
	) {
		throw new Error("The onboarding state has another shape");
	}
	const claude = parseLogin(value.logins.claude);
	const codex = parseLogin(value.logins.codex);
	if (claude === null || codex === null) {
		throw new Error("The onboarding state has a login of another shape");
	}
	return {
		bootId: value.bootId,
		provider: value.provider,
		logins: { claude, codex },
		codexLoginUrl: optionalText(value.codexLoginUrl),
	};
}

/** The token check's answer; one of another shape reads as Anthropic not answering. */
export function parseTokenCheck(value: unknown): ClaudeTokenCheck {
	if (!isRecord(value)) return { ok: false, reason: "unreachable" };
	if (value.ok === true) {
		return {
			ok: true,
			email: optionalText(value.email),
			plan: optionalText(value.plan),
		};
	}
	return {
		ok: false,
		reason: isProblem(value.reason) ? value.reason : "unreachable",
	};
}

/** The message a refused request carries, as the backend answers `{ message }`. */
export function refusalMessage(error: unknown): string | null {
	if (!isRecord(error) || !isRecord(error.data)) return null;
	return optionalText(error.data.message) ?? null;
}

export function createOnboardingApi(http: OnboardingHttp): OnboardingApi {
	return {
		readState: async () =>
			parseOnboardingState(await http.get(ONBOARDING_PATH)),
		checkClaudeToken: async (token) =>
			parseTokenCheck(await http.post(CLAUDE_TOKEN_PATH, { token })),
		setProvider: async (provider) =>
			parseOnboardingState(await http.post(PROVIDER_PATH, { provider })),
		finishCodexSignIn: async (url) => {
			await http.post(CODEX_CALLBACK_PATH, { url });
		},
	};
}
