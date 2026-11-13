<script setup lang="ts">
import { computed, ref } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import { PROVIDERS, type ProviderName } from "../../onboarding/contract";
import type { OnboardingView } from "../../onboarding/flow";
import { useOnboarding } from "../../onboarding/runtime";
import OnboardingFrame from "./OnboardingFrame.vue";
import { PROVIDER_NAMES } from "./login-text";
import ProviderMark from "./ProviderMark.vue";

/** Which AI the assistant runs on: a login that works is used as it is, any other is set up next. */
const props = defineProps<{
	view: Extract<OnboardingView, { kind: "ai" }>;
}>();

const onboarding = useOnboarding();
const { t } = useChatI18n();
const busy = ref(false);

const SUBSCRIPTIONS: Record<ProviderName, string> = {
	claude: "dms_ai.views.onboarding.ai.claude_text",
	codex: "dms_ai.views.onboarding.ai.codex_text",
};

function statusOf(provider: ProviderName) {
	return onboarding.state.value?.logins[provider].status ?? "signed-out";
}

const chosen = computed(() =>
	props.view.choice === null
		? undefined
		: onboarding.state.value?.logins[props.view.choice],
);
const works = computed(() => chosen.value?.status === "signed-in");

const hint = computed(() => {
	const login = chosen.value;
	if (props.view.choice === null || login === undefined) return null;
	if (login.status === "expired") {
		return {
			tone: "text-warning",
			text: t(
				props.view.choice === "claude"
					? "dms_ai.views.onboarding.ai.expired_claude"
					: "dms_ai.views.onboarding.ai.expired_codex",
			),
		};
	}
	if (login.status !== "signed-in") return null;
	const email = login.email;
	const claude = props.view.choice === "claude";
	const text =
		email === undefined
			? t(
					claude
						? "dms_ai.views.onboarding.ai.found_claude_plain"
						: "dms_ai.views.onboarding.ai.found_codex_plain",
				)
			: t(
					claude
						? "dms_ai.views.onboarding.ai.found_claude"
						: "dms_ai.views.onboarding.ai.found_codex",
					{ email },
				);
	return { tone: "text-success", text };
});

async function proceed(): Promise<void> {
	const provider = props.view.choice;
	if (provider === null) return;
	if (!works.value) {
		onboarding.send({ type: "sign-in", provider });
		return;
	}
	busy.value = true;
	await onboarding.useLogin(provider, "signed-in");
	busy.value = false;
}
</script>

<template>
	<OnboardingFrame
		:title="t('dms_ai.views.onboarding.ai.title')"
		:lede="t('dms_ai.views.onboarding.ai.lede')"
	>
		<div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup">
			<button
				v-for="provider in PROVIDERS"
				:key="provider"
				type="button"
				role="radio"
				:aria-checked="view.choice === provider"
				:data-provider="provider"
				class="focus-visible:ring-primary relative flex flex-col gap-2.5 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2"
				:class="
					view.choice === provider
						? 'border-primary bg-(--dms-accent-tint) ring-primary ring-1 ring-inset'
						: 'border-default hover:border-accented'
				"
				@click="onboarding.send({ type: 'choose', provider })"
			>
				<UBadge
					v-if="statusOf(provider) === 'signed-in'"
					class="absolute right-3 top-3"
					color="success"
					variant="soft"
					size="sm"
					:label="t('dms_ai.views.onboarding.ai.signed_in')"
				/>
				<UBadge
					v-else-if="statusOf(provider) === 'expired'"
					class="absolute right-3 top-3"
					color="warning"
					variant="soft"
					size="sm"
					:label="t('dms_ai.views.onboarding.ai.expired')"
				/>
				<span
					v-else
					class="absolute right-3.5 top-3.5 size-4 rounded-full border"
					:class="
						view.choice === provider
							? 'border-primary border-[5px]'
							: 'border-accented'
					"
					aria-hidden="true"
				/>
				<span class="flex items-center gap-2.5">
					<ProviderMark :provider="provider" />
					<span class="text-highlighted text-[15px] font-semibold">
						{{ PROVIDER_NAMES[provider] }}
					</span>
				</span>
				<span class="text-toned text-[13px]">
					{{ t(SUBSCRIPTIONS[provider]) }}
				</span>
			</button>
		</div>
		<p
			v-if="hint"
			class="mt-3 flex items-start gap-1.5 text-[13px]/5"
			:class="hint.tone"
		>
			<UIcon name="i-ph-info" class="mt-0.5 size-4 shrink-0" />
			{{ hint.text }}
		</p>
		<template #footer>
			<UButton
				v-if="onboarding.flow.value.history.length > 0"
				:label="t('dms_ai.views.onboarding.back')"
				icon="i-ph-arrow-left"
				color="neutral"
				variant="ghost"
				@click="onboarding.send({ type: 'back' })"
			/>
			<span class="flex-1" />
			<UButton
				:label="
					works
						? t('dms_ai.views.onboarding.ai.use')
						: t('dms_ai.views.onboarding.proceed')
				"
				trailing-icon="i-ph-arrow-right"
				:disabled="view.choice === null"
				:loading="busy"
				@click="proceed"
			/>
		</template>
	</OnboardingFrame>
</template>
