<script setup lang="ts">
import { computed, ref } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import type { OnboardingView } from "../../onboarding/flow";
import { useOnboarding } from "../../onboarding/runtime";
import { loginDetail, loginTitle } from "./login-text";
import OnboardingDontShow from "./OnboardingDontShow.vue";
import OnboardingFrame from "./OnboardingFrame.vue";
import ProviderMark from "./ProviderMark.vue";

/** A login that works was found on the machine: one click uses it and skips the AI step. */
const props = defineProps<{
	view: Extract<OnboardingView, { kind: "ready" }>;
}>();

const onboarding = useOnboarding();
const { t } = useChatI18n();
const busy = ref(false);

const login = computed(() => {
	const found = onboarding.state.value?.logins[props.view.provider];
	return found?.status === "signed-out" ? undefined : found;
});

async function useLogin(): Promise<void> {
	busy.value = true;
	await onboarding.useLogin(props.view.provider, "use-login");
	busy.value = false;
}
</script>

<template>
	<OnboardingFrame
		:title="t('dms_assistant.views.onboarding.ready.title')"
		:lede="t('dms_assistant.views.onboarding.ready.lede')"
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
			class="border-default bg-elevated/50 mt-6 flex items-center gap-3 rounded-xl border px-4 py-3"
		>
			<ProviderMark :provider="view.provider" />
			<div class="min-w-0">
				<p class="text-highlighted text-sm font-semibold">
					{{ loginTitle(t, view.provider, login) }}
				</p>
				<p class="text-muted truncate text-xs">
					{{ loginDetail(t, login) }}
				</p>
			</div>
			<UBadge
				class="ms-auto"
				color="success"
				variant="soft"
				icon="i-ph-check-bold"
				:label="t('dms_assistant.views.onboarding.ready.works')"
			/>
		</div>
		<div class="mt-3">
			<UButton
				:label="t('dms_assistant.views.onboarding.ready.other')"
				variant="link"
				class="px-0"
				@click="onboarding.send({ type: 'choose-another' })"
			/>
		</div>
		<template #footer>
			<OnboardingDontShow />
			<span class="flex-1" />
			<UButton
				:label="t('dms_assistant.views.onboarding.ready.use')"
				trailing-icon="i-ph-arrow-right"
				:loading="busy"
				@click="useLogin"
			/>
		</template>
	</OnboardingFrame>
</template>
