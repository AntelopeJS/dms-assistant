<script setup lang="ts">
import { computed } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import type { Mockup, MockupSource } from "../../onboarding/mockups";
import { useOnboarding } from "../../onboarding/runtime";
import { MOCKUP_PATH } from "../../runtime/constants";
import OnboardingDontShow from "./OnboardingDontShow.vue";
import OnboardingFrame from "./OnboardingFrame.vue";
import { relativeTime } from "./when";

/** A project with content: its last conversation, latest mockups and connected databases. */
const MOCKUPS_SHOWN = 3;

const ENGINE_ICONS: Record<string, string> = {
	postgres: "i-ph-cylinder",
	postgresql: "i-ph-cylinder",
	mongodb: "i-ph-leaf",
	rethinkdb: "i-ph-circles-three",
};

const SOURCE_KEYS: Record<MockupSource, string> = {
	chat: "dms_ai.views.onboarding.continue.sources.chat",
	"claude-code": "dms_ai.views.onboarding.continue.sources.claude_code",
	codex: "dms_ai.views.onboarding.continue.sources.codex",
};

const onboarding = useOnboarding();
const { t, locale } = useChatI18n();

const content = computed(() => onboarding.content.value);
const last = computed(() => content.value.conversations[0]);
const mockups = computed(() => content.value.mockups.slice(0, MOCKUPS_SHOWN));

function mockupDetail(mockup: Mockup): string {
	return [
		t(
			"dms_ai.views.onboarding.continue.pages",
			{ count: mockup.pages },
			mockup.pages,
		),
		mockup.source === undefined
			? undefined
			: t("dms_ai.views.onboarding.continue.from", {
					source: t(SOURCE_KEYS[mockup.source]),
				}),
		mockup.openComments
			? t(
					"dms_ai.views.onboarding.continue.comments",
					{ count: mockup.openComments },
					mockup.openComments,
				)
			: relativeTime(mockup.updatedAtMs, Date.now(), locale.value),
	]
		.filter((part) => part !== undefined)
		.join(" · ");
}

function openMockup(mockup: Mockup): void {
	onboarding.navigate(`${MOCKUP_PATH}?name=${encodeURIComponent(mockup.name)}`);
}
</script>

<template>
	<OnboardingFrame :title="t('dms_ai.views.onboarding.continue.title')">
		<section v-if="last" class="mt-5">
			<h3
				class="text-muted mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
			>
				{{ t("dms_ai.views.onboarding.continue.pick_up") }}
			</h3>
			<div
				class="border-default flex items-center gap-3 rounded-xl border px-3 py-2.5"
			>
				<span
					class="bg-(--dms-assistant-tint) text-secondary grid size-8 shrink-0 place-items-center rounded-lg"
					aria-hidden="true"
				>
					<UIcon name="i-ph-chat-circle-dots" class="size-4" />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-highlighted truncate text-[13px] font-semibold">
						“{{ last.title }}”
					</p>
					<p class="text-muted text-xs">
						{{
							t("dms_ai.views.onboarding.continue.chat", {
								when: relativeTime(last.updatedAtMs, Date.now(), locale),
							})
						}}
					</p>
				</div>
				<UButton
					:label="t('dms_ai.views.onboarding.continue.resume')"
					color="neutral"
					variant="outline"
					size="sm"
					@click="onboarding.resume(last.id)"
				/>
			</div>
		</section>

		<section v-if="mockups.length > 0" class="mt-5">
			<h3
				class="text-muted mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
			>
				{{ t("dms_ai.views.onboarding.continue.mockups") }}
			</h3>
			<ul class="flex flex-col gap-2">
				<li v-for="mockup in mockups" :key="mockup.name">
					<button
						type="button"
						class="border-default hover:bg-elevated/60 focus-visible:ring-primary flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2"
						:data-mockup="mockup.name"
						@click="openMockup(mockup)"
					>
						<span
							class="bg-elevated text-secondary grid size-8 shrink-0 place-items-center rounded-lg"
							aria-hidden="true"
						>
							<UIcon name="i-ph-frame-corners" class="size-4" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-highlighted truncate text-[13px] font-semibold">
								{{ mockup.title }}
							</p>
							<p class="text-muted truncate text-xs">
								{{ mockupDetail(mockup) }}
							</p>
						</div>
						<UBadge
							v-if="mockup.status === 'built'"
							color="success"
							variant="soft"
							size="sm"
							:label="t('dms_ai.views.onboarding.continue.built')"
						/>
						<UBadge
							v-else
							color="neutral"
							variant="soft"
							size="sm"
							:label="t('dms_ai.views.onboarding.continue.draft')"
						/>
						<UIcon
							name="i-ph-caret-right"
							class="text-dimmed size-3.5 shrink-0"
							aria-hidden="true"
						/>
					</button>
				</li>
			</ul>
		</section>

		<section v-if="content.databases.length > 0" class="mt-5">
			<h3
				class="text-muted mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
			>
				{{ t("dms_ai.views.onboarding.continue.databases") }}
			</h3>
			<div class="flex flex-wrap gap-1.5">
				<UBadge
					color="neutral"
					variant="soft"
					icon="i-ph-database"
					:label="t('dms_ai.views.onboarding.continue.project')"
				/>
				<UBadge
					v-for="database in content.databases"
					:key="database.id"
					color="primary"
					variant="soft"
					:icon="ENGINE_ICONS[database.engine ?? ''] ?? 'i-ph-database'"
					:label="
						t('dms_ai.views.onboarding.continue.external', {
							name: database.id,
						})
					"
				/>
			</div>
		</section>

		<template #footer>
			<OnboardingDontShow />
			<span class="flex-1" />
			<UButton
				:label="t('dms_ai.views.onboarding.continue.new_scratch')"
				icon="i-ph-plus"
				color="neutral"
				variant="ghost"
				@click="onboarding.send({ type: 'pick', path: 'scratch' })"
			/>
			<UButton
				v-if="onboarding.canConnectDatabase"
				:label="t('dms_ai.views.onboarding.continue.connect')"
				icon="i-ph-database"
				color="neutral"
				variant="ghost"
				@click="onboarding.send({ type: 'pick', path: 'connect-database' })"
			/>
		</template>
	</OnboardingFrame>
</template>
