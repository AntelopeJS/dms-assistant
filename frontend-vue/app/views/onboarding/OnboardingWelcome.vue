<script setup lang="ts">
import { computed } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import { useOnboarding } from "../../onboarding/runtime";
import OnboardingDontShow from "./OnboardingDontShow.vue";
import OnboardingFrame from "./OnboardingFrame.vue";

/** The first view of a project with no working AI login: what the popup will do, in three steps. */
const onboarding = useOnboarding();
const { t } = useChatI18n();

const steps = computed(() => [
	{
		title: t("dms_assistant.views.onboarding.welcome.ai_title"),
		text: t("dms_assistant.views.onboarding.welcome.ai_text"),
	},
	{
		title: t("dms_assistant.views.onboarding.welcome.start_title"),
		text: t("dms_assistant.views.onboarding.welcome.start_text"),
	},
	{
		title: t("dms_assistant.views.onboarding.welcome.shape_title"),
		text: t("dms_assistant.views.onboarding.welcome.shape_text"),
	},
]);
</script>

<template>
	<OnboardingFrame :title="t('dms_assistant.views.onboarding.welcome.title')">
		<template #lead>
			<DmsIconWell
				icon="i-ph-sparkle"
				tone="secondary"
				size="2xl"
				class="mb-4"
			/>
		</template>
		<template #lede>
			{{ t("dms_assistant.views.onboarding.welcome.lede_before") }}
			<UIcon name="i-ph-sparkle" class="text-secondary size-4 align-[-3px]" />
			{{ t("dms_assistant.views.onboarding.welcome.lede_after") }}
		</template>
		<ol class="mt-6 flex flex-col gap-4">
			<li v-for="(step, index) in steps" :key="index" class="flex gap-3.5">
				<span
					class="border-default bg-elevated text-muted mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold"
					aria-hidden="true"
				>
					{{ index + 1 }}
				</span>
				<div>
					<p class="text-highlighted text-[13px]/5 font-semibold">
						{{ step.title }}
					</p>
					<p class="text-muted text-[12.5px]/5">{{ step.text }}</p>
				</div>
			</li>
		</ol>
		<template #footer>
			<OnboardingDontShow />
			<span class="flex-1" />
			<UButton
				:label="t('dms_assistant.views.onboarding.welcome.skip')"
				color="neutral"
				variant="ghost"
				@click="onboarding.close()"
			/>
			<UButton
				:label="t('dms_assistant.views.onboarding.welcome.get_started')"
				trailing-icon="i-ph-arrow-right"
				@click="onboarding.send({ type: 'get-started' })"
			/>
		</template>
	</OnboardingFrame>
</template>
