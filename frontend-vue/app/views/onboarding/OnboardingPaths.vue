<script setup lang="ts">
import { computed } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import { engineNames } from "../../onboarding/connect-database";
import { useOnboarding } from "../../onboarding/runtime";
import OnboardingDontShow from "./OnboardingDontShow.vue";
import OnboardingFrame from "./OnboardingFrame.vue";

/** The starting point of an empty project: from scratch, or from a database it already has. */
const onboarding = useOnboarding();
const { t, locale } = useChatI18n();

const paths = computed(() => [
	{
		id: "scratch" as const,
		icon: "i-ph-sparkle",
		tone: "bg-(--dms-assistant-tint) text-secondary",
		title: t("dms_ai.views.onboarding.paths.scratch_title"),
		text: t("dms_ai.views.onboarding.paths.scratch_text"),
	},
	...(onboarding.canConnectDatabase
		? [
				{
					id: "connect-database" as const,
					icon: "i-ph-database",
					tone: "bg-(--dms-accent-tint) text-primary",
					title: t("dms_ai.views.onboarding.paths.database_title"),
					text: t("dms_ai.views.onboarding.paths.database_text", {
						engines: engineNames(locale.value),
					}),
				},
			]
		: []),
]);
</script>

<template>
	<OnboardingFrame
		:title="t('dms_ai.views.onboarding.paths.title')"
		:lede="t('dms_ai.views.onboarding.paths.lede')"
	>
		<div class="mt-6 flex flex-col gap-2.5">
			<button
				v-for="path in paths"
				:key="path.id"
				type="button"
				:data-path="path.id"
				class="border-default hover:border-accented hover:bg-elevated/50 focus-visible:ring-primary group flex items-start gap-3.5 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2"
				@click="onboarding.send({ type: 'pick', path: path.id })"
			>
				<span
					class="grid size-10 shrink-0 place-items-center rounded-[10px]"
					:class="path.tone"
					aria-hidden="true"
				>
					<UIcon :name="path.icon" class="size-5" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="text-highlighted block text-sm font-semibold">
						{{ path.title }}
					</span>
					<span class="text-muted mt-0.5 block text-[13px]/5">
						{{ path.text }}
					</span>
				</span>
				<UIcon
					name="i-ph-arrow-right"
					class="text-dimmed mt-3 size-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
				/>
			</button>
		</div>
		<template #footer>
			<OnboardingDontShow />
			<span class="flex-1" />
			<UButton
				:label="t('dms_ai.views.onboarding.paths.explore')"
				color="neutral"
				variant="ghost"
				@click="onboarding.close()"
			/>
		</template>
	</OnboardingFrame>
</template>
