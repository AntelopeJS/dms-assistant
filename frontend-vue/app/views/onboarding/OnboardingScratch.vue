<script setup lang="ts">
import { computed, ref } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import { mockupPrompt } from "../../onboarding/prompts";
import { useOnboarding } from "../../onboarding/runtime";
import OnboardingFrame from "./OnboardingFrame.vue";
import { providerName } from "./login-text";

/** "Start from scratch": a description, sent to the chat as a new conversation's first message. */
const onboarding = useOnboarding();
const { t } = useChatI18n();

const description = ref("");

const suggestions = computed(() => [
	t("dms_assistant.views.onboarding.scratch.suggestion_crm"),
	t("dms_assistant.views.onboarding.scratch.suggestion_inventory"),
	t("dms_assistant.views.onboarding.scratch.suggestion_events"),
	t("dms_assistant.views.onboarding.scratch.suggestion_support"),
]);

const provider = computed(() => onboarding.state.value?.provider ?? "claude");
const isEmpty = computed(() => description.value.trim() === "");

function start(): void {
	if (isEmpty.value) return;
	onboarding.startConversation(mockupPrompt(description.value));
}
</script>

<template>
	<OnboardingFrame
		:title="t('dms_assistant.views.onboarding.scratch.title')"
		:lede="t('dms_assistant.views.onboarding.scratch.lede')"
	>
		<div
			class="border-default bg-elevated/40 focus-within:border-secondary focus-within:ring-secondary mt-5 rounded-xl border focus-within:ring-1"
		>
			<UTextarea
				v-model="description"
				:placeholder="t('dms_assistant.views.onboarding.scratch.placeholder')"
				:rows="3"
				autoresize
				:maxrows="8"
				variant="none"
				class="w-full"
				:ui="{ base: 'px-3.5 pt-3 text-sm/6' }"
				data-description
				@keydown.meta.enter.prevent="start"
				@keydown.ctrl.enter.prevent="start"
			/>
			<div class="flex items-center gap-1 px-3 pb-2.5">
				<UBadge
					color="secondary"
					variant="soft"
					size="sm"
					icon="i-ph-sparkle"
					:label="providerName(provider)"
				/>
				<span class="flex-1" />
				<UKbd value="meta" />
				<UKbd value="enter" />
			</div>
		</div>
		<div class="mt-3 flex flex-wrap gap-2">
			<UButton
				v-for="suggestion in suggestions"
				:key="suggestion"
				:label="suggestion"
				color="neutral"
				variant="outline"
				size="sm"
				class="rounded-full"
				@click="description = suggestion"
			/>
		</div>
		<template #footer>
			<UButton
				:label="t('dms_assistant.views.onboarding.back')"
				icon="i-ph-arrow-left"
				color="neutral"
				variant="ghost"
				@click="onboarding.send({ type: 'back' })"
			/>
			<span class="flex-1" />
			<UButton
				:label="t('dms_assistant.views.onboarding.scratch.start')"
				icon="i-ph-sparkle"
				color="secondary"
				:disabled="isEmpty"
				data-start
				@click="start"
			/>
		</template>
	</OnboardingFrame>
</template>
