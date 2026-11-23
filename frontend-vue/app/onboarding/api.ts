import { z } from "zod";
import type { WireValue } from "../runtime/wire-value";
import {
	CLAUDE_TOKEN_PATH,
	type ClaudeTokenCheck,
	CODEX_CALLBACK_PATH,
	ONBOARDING_PATH,
	type OnboardingState,
	PROVIDER_PATH,
	type ProviderName,
} from "./contract";

/** The dashboard's authenticated requests, as the assistant session hands them out. */
export interface OnboardingHttp {
	get: (path: string) => Promise<WireValue>;
	post: (path: string, body: WireValue) => Promise<WireValue>;
}

export interface OnboardingApi {
	readState: () => Promise<OnboardingState>;
	/** Checks the token live against Anthropic; the backend saves it when it works. */
	checkClaudeToken: (token: string) => Promise<ClaudeTokenCheck>;
	setProvider: (provider: ProviderName) => Promise<OnboardingState>;
	/** Completes a ChatGPT sign-in from the address a remote browser could not load. */
	finishCodexSignIn: (url: string) => Promise<void>;
}

const OptionalText = z.string().optional().catch(undefined);

const LoginSourceSchema = z.enum(["env", "saved", "claude-cli", "chatgpt"]);

const LoginSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("signed-out") }),
	z.object({
		status: z.literal("expired"),
		source: LoginSourceSchema,
		email: OptionalText,
	}),
	z.object({
		status: z.literal("signed-in"),
		source: LoginSourceSchema,
		email: OptionalText,
		plan: OptionalText,
	}),
]);

const OnboardingStateSchema = z.object({
	bootId: z.string(),
	provider: z.enum(["claude", "codex"]),
	logins: z.object({ claude: z.unknown(), codex: z.unknown() }),
	codexLoginUrl: OptionalText,
});

const AcceptedTokenSchema = z.object({
	ok: z.literal(true),
	email: OptionalText,
	plan: OptionalText,
});

const RefusedTokenSchema = z.object({
	reason: z
		.enum(["rejected", "unreachable", "malformed", "unsaved"])
		.catch("unreachable"),
});

/** The message a refused request carries, as the backend answers `{ message }`. */
export const RefusalSchema = z.object({
	data: z.object({ message: z.string() }),
});

/** The backend's onboarding state, or an error naming what it answered instead. */
export function parseOnboardingState(value: WireValue): OnboardingState {
	const state = OnboardingStateSchema.safeParse(value);
	if (!state.success) {
		throw new Error("The onboarding state has another shape");
	}
	const { bootId, provider, logins, codexLoginUrl } = state.data;
	const claude = LoginSchema.safeParse(logins.claude);
	const codex = LoginSchema.safeParse(logins.codex);
	if (!claude.success || !codex.success) {
		throw new Error("The onboarding state has a login of another shape");
	}
	return {
		bootId,
		provider,
		logins: { claude: claude.data, codex: codex.data },
		codexLoginUrl,
	};
}

/** The token check's answer; one of another shape reads as Anthropic not answering. */
export function parseTokenCheck(value: WireValue): ClaudeTokenCheck {
	const accepted = AcceptedTokenSchema.safeParse(value);
	if (accepted.success) return accepted.data;
	const refused = RefusedTokenSchema.safeParse(value);
	return {
		ok: false,
		reason: refused.success ? refused.data.reason : "unreachable",
	};
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
