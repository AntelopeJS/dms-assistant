<script setup lang="ts">
import { computed } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import type { OnboardingView } from "../../onboarding/flow";
import { useOnboarding } from "../../onboarding/runtime";
import { accountSummary, sourceText } from "./login-text";
import OnboardingFrame from "./OnboardingFrame.vue";

/** A new login works: the account it runs on, then on to the starting point. */
const props = defineProps<{
	view: Extract<OnboardingView, { kind: "connected" }>;
}>();

const onboarding = useOnboarding();
const { t } = useChatI18n();

const login = computed(() => {
	const found = onboarding.state.value?.logins[props.view.provider];
	return found?.status === "signed-in" ? found : undefined;
});

const source = computed(() => {
	const text = login.value ? sourceText(t, login.value.source) : "";
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
});
</script>

<template>
	<OnboardingFrame
		:title="
			view.provider === 'claude'
				? t('dms_ai.views.onboarding.connected.title_claude')
				: t('dms_ai.views.onboarding.connected.title_codex')
		"
		:lede="t('dms_ai.views.onboarding.connected.lede')"
	>
		<template #lead>
			<DmsIconWell
				icon="i-ph-sparkle"
				tone="secondary"
				size="2xl"
				class="mb-4"
			/>
		</template>
		<div
			v-if="login"
			class="bg-success/10 text-success mt-6 flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold"
		>
			<UIcon name="i-ph-check-circle-fill" class="size-5 shrink-0" />
			<span class="min-w-0 truncate">
				{{ accountSummary(view.provider, login) }}
			</span>
			<span class="ms-auto shrink-0 text-xs font-medium opacity-80">
				{{ source }}
			</span>
		</div>
		<template #footer>
			<span class="flex-1" />
			<UButton
				:label="t('dms_ai.views.onboarding.connected.next')"
				trailing-icon="i-ph-arrow-right"
				@click="onboarding.send({ type: 'next' })"
			/>
		</template>
	</OnboardingFrame>
</template>
