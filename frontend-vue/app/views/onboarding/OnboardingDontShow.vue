<script setup lang="ts">
import { useChatI18n } from "../../chat/composables/useChatI18n";
import { useOnboarding } from "../../onboarding/runtime";

/** "Don't show on startup": a preference of this browser, read before the popup opens on its own. */
const onboarding = useOnboarding();
const { t } = useChatI18n();
</script>

<template>
	<UCheckbox
		v-model="onboarding.dontShow.value"
		:label="t('dms_assistant.views.onboarding.dont_show')"
		color="neutral"
		:ui="{ label: 'text-[13px] font-normal text-toned' }"
	/>
</template>
