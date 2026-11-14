<script setup lang="ts">
import { computed, inject } from "vue";
import { useChatI18n } from "../chat/composables/useChatI18n";
import { ONBOARDING_CONTROLLER_KEY } from "../onboarding/runtime";
import { accountSummary } from "../views/onboarding/login-text";

/**
 * The card the DMS widget dock unfolds from the assistant's chip: the AI the assistant runs on and
 * the project's mockups. The chip itself opens the onboarding popup and carries its attention dot.
 */
const onboarding = inject(ONBOARDING_CONTROLLER_KEY, null);
const { t } = useChatI18n();

const controller = computed(() => onboarding?.value ?? null);

const account = computed(() => {
	const state = controller.value?.state.value;
	if (!state) return null;
	const login = state.logins[state.provider];
	return login.status === "signed-in"
		? accountSummary(state.provider, { plan: login.plan })
		: null;
});
const mockups = computed(
	() => controller.value?.content.value.mockups.length ?? 0,
);
</script>

<template>
	<div v-if="controller" class="flex w-60 flex-col gap-3 p-3">
		<div class="flex items-center gap-2">
			<DmsIconWell icon="i-ph-sparkle" tone="secondary" size="2xs" />
			<span class="text-highlighted text-sm font-semibold">
				{{ t("dms_assistant.views.onboarding.widget.label") }}
			</span>
		</div>
		<dl class="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5 text-[13px]">
			<dt class="text-muted">
				{{ t("dms_assistant.views.onboarding.widget.ai") }}
			</dt>
			<dd class="text-highlighted flex items-center gap-1.5">
				<span
					class="size-1.5 rounded-full"
					:class="account ? 'bg-success' : 'bg-warning'"
					aria-hidden="true"
				/>
				{{
					account ?? t("dms_assistant.views.onboarding.widget.not_connected")
				}}
			</dd>
			<template v-if="mockups > 0">
				<dt class="text-muted">
					{{ t("dms_assistant.views.onboarding.widget.mockups") }}
				</dt>
				<dd class="text-highlighted">{{ mockups }}</dd>
			</template>
		</dl>
	</div>
</template>
