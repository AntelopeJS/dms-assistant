import type { Translate } from "../../chat/composables/useChatI18n";
import type {
	LoginSource,
	ProviderLogin,
	ProviderName,
} from "../../onboarding/contract";

/** A login the sidecar found, working or not. */
export type FoundLogin = Exclude<ProviderLogin, { status: "signed-out" }>;

export const PROVIDER_NAMES: Record<ProviderName, string> = {
	claude: "Claude",
	codex: "Codex",
};

/** The account a provider's subscription belongs to. */
const ACCOUNT_NAMES: Record<ProviderName, string> = {
	claude: "Claude",
	codex: "ChatGPT",
};

const SOURCE_KEYS: Record<LoginSource, string> = {
	env: "dms_assistant.views.onboarding.login.source_env",
	saved: "dms_assistant.views.onboarding.login.source_saved",
	"claude-cli": "dms_assistant.views.onboarding.login.source_claude_cli",
	chatgpt: "dms_assistant.views.onboarding.login.source_chatgpt",
};

/** A plan as the sidecar spells it, as a person reads it: `max` is Max. */
export function planName(plan: string | undefined): string | undefined {
	const words = plan?.replace(/[_-]+/g, " ").trim();
	if (!words) return undefined;
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** "Claude · Max": the provider, with its plan when the login names one. */
export function loginTitle(
	t: Translate,
	provider: ProviderName,
	login: FoundLogin,
): string {
	const plan = login.status === "signed-in" ? planName(login.plan) : undefined;
	const name = PROVIDER_NAMES[provider];
	return plan === undefined
		? name
		: t("dms_assistant.views.onboarding.login.with_plan", { name, plan });
}

/** "owner@example.com · found in ~/.claude": who, and where the login comes from. */
export function loginDetail(t: Translate, login: FoundLogin): string {
	const source = t(SOURCE_KEYS[login.source]);
	return login.email === undefined
		? source
		: t("dms_assistant.views.onboarding.login.detail", {
				email: login.email,
				source,
			});
}

/** Where the login comes from, as a sentence ends with it. */
export function sourceText(t: Translate, source: LoginSource): string {
	return t(SOURCE_KEYS[source]);
}

/** "Claude Max · owner@example.com": the account the assistant now runs on. */
export function accountSummary(
	provider: ProviderName,
	login: { email?: string; plan?: string },
): string {
	const name = [ACCOUNT_NAMES[provider], planName(login.plan)]
		.filter((part) => part !== undefined)
		.join(" ");
	return login.email === undefined ? name : `${name} · ${login.email}`;
}
