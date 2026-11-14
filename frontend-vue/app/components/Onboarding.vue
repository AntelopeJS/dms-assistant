<script setup lang="ts">
import { computed, inject } from "vue";
import { useChatI18n } from "../chat/composables/useChatI18n";
import { PROGRESS } from "../onboarding/flow";
import {
	ONBOARDING_COMPONENT_NAME,
	ONBOARDING_CONTROLLER_KEY,
} from "../onboarding/runtime";
import OnboardingAi from "../views/onboarding/OnboardingAi.vue";
import OnboardingAnalysis from "../views/onboarding/OnboardingAnalysis.vue";
import OnboardingClaude from "../views/onboarding/OnboardingClaude.vue";
import OnboardingCodex from "../views/onboarding/OnboardingCodex.vue";
import OnboardingConnected from "../views/onboarding/OnboardingConnected.vue";
import OnboardingContinue from "../views/onboarding/OnboardingContinue.vue";
import OnboardingDatabase from "../views/onboarding/OnboardingDatabase.vue";
import OnboardingPaths from "../views/onboarding/OnboardingPaths.vue";
import OnboardingReady from "../views/onboarding/OnboardingReady.vue";
import OnboardingScratch from "../views/onboarding/OnboardingScratch.vue";
import OnboardingWelcome from "../views/onboarding/OnboardingWelcome.vue";

defineOptions({ name: ONBOARDING_COMPONENT_NAME });

/**
 * The onboarding popup, drawn over every page once the assistant runs: a progress bar of three
 * segments, the close button, and the view its flow is on. Escape and the close button close it;
 * a click outside does not, so a token half pasted is not lost.
 */
const onboarding = inject(ONBOARDING_CONTROLLER_KEY, null);
const { t } = useChatI18n();

const controller = computed(() => onboarding?.value ?? null);
const view = computed(() => controller.value?.flow.value.view ?? null);
const progress = computed(() =>
	view.value === null ? 0 : PROGRESS[view.value.kind],
);

function keepOpen(event: Event): void {
	event.preventDefault();
}

function toggle(open: boolean): void {
	if (!open) controller.value?.close();
}
</script>

<template>
	<UModal
		v-if="controller && view"
		:open="controller.isOpen.value"
		:title="t('dms_assistant.views.onboarding.widget.label')"
		:content="{ onInteractOutside: keepOpen }"
		:ui="{
			content:
				'sm:max-w-[600px] overflow-hidden rounded-2xl divide-y-0 ring-1 ring-default',
		}"
		data-onboarding
		@update:open="toggle"
	>
		<template #content>
			<div class="flex items-center justify-between px-5 pb-3 pt-4">
				<div
					class="flex gap-1.5"
					role="img"
					:aria-label="
						t('dms_assistant.views.onboarding.progress', { step: progress + 1 })
					"
				>
					<span
						v-for="segment in 3"
						:key="segment"
						class="h-[3px] w-11 rounded-full transition-colors duration-300"
						:class="segment - 1 <= progress ? 'bg-primary' : 'bg-accented'"
					/>
				</div>
				<UButton
					icon="i-ph-x"
					color="neutral"
					variant="ghost"
					size="sm"
					:aria-label="t('dms_assistant.views.onboarding.close')"
					@click="controller.close()"
				/>
			</div>
			<OnboardingWelcome v-if="view.kind === 'welcome'" />
			<OnboardingReady v-else-if="view.kind === 'ready'" :view="view" />
			<OnboardingAi v-else-if="view.kind === 'ai'" :view="view" />
			<OnboardingClaude v-else-if="view.kind === 'claude'" />
			<OnboardingCodex v-else-if="view.kind === 'codex'" :view="view" />
			<OnboardingConnected v-else-if="view.kind === 'connected'" :view="view" />
			<OnboardingPaths v-else-if="view.kind === 'paths'" />
			<OnboardingContinue v-else-if="view.kind === 'continue'" />
			<OnboardingScratch v-else-if="view.kind === 'scratch'" />
			<OnboardingDatabase v-else-if="view.kind === 'connect-database'" />
			<OnboardingAnalysis v-else :view="view" />
		</template>
	</UModal>
</template>
