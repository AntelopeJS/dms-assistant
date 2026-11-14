<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useBuilderApi } from "../../../builder/app/runtime/api";
import {
	ENGINES,
	engineOfScheme,
	refusalText,
} from "../../../builder/app/runtime/database-connect";
import type { MappingProposal } from "../../../builder/app/runtime/database-types";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import {
	mappingInput,
	type ScreenKind,
	screensOf,
	tablesOf,
} from "../../onboarding/analysis";
import type { OnboardingView } from "../../onboarding/flow";
import { databaseMockupPrompt } from "../../onboarding/prompts";
import { useOnboarding } from "../../onboarding/runtime";
import OnboardingFrame from "./OnboardingFrame.vue";

/**
 * What the analysis of a new connection found: its tables, and the screens it proposes, to build
 * at once through the builder's mapping or to draft first as a mockup in the chat.
 */
const props = defineProps<{
	view: Extract<OnboardingView, { kind: "analysis" }>;
}>();

const KINDS: Record<ScreenKind, string> = {
	table: "dms_assistant.views.onboarding.analysis.kind_table",
	status: "dms_assistant.views.onboarding.analysis.kind_status",
	tabs: "dms_assistant.views.onboarding.analysis.kind_tabs",
	stats: "dms_assistant.views.onboarding.analysis.kind_stats",
};

const onboarding = useOnboarding();
const api = useBuilderApi();
const { t, locale } = useChatI18n();

const proposal = ref<MappingProposal | null>(null);
const ticked = ref<ReadonlySet<string>>(new Set());
const problem = ref<string | null>(null);
const building = ref(false);

const screens = computed(() =>
	proposal.value === null ? [] : screensOf(proposal.value),
);
const tables = computed(() =>
	proposal.value === null ? [] : tablesOf(proposal.value),
);
const chosen = computed(() =>
	screens.value.filter((screen) => ticked.value.has(screen.relation)),
);

const lede = computed(() => {
	if (proposal.value === null) return "";
	const engine = proposal.value.database.engine;
	const known = engineOfScheme(engine);
	return t("dms_assistant.views.onboarding.analysis.lede", {
		engine: known === undefined ? engine : ENGINES[known].label,
		tables: t(
			"dms_assistant.views.onboarding.analysis.tables_count",
			{ count: tables.value.length },
			tables.value.length,
		),
	});
});

function rows(count: number | undefined): string {
	return count === undefined
		? ""
		: new Intl.NumberFormat(locale.value).format(count);
}

function tick(relation: string, on: boolean): void {
	const next = new Set(ticked.value);
	if (on) next.add(relation);
	else next.delete(relation);
	ticked.value = next;
}

async function load(): Promise<void> {
	try {
		const latest = await api.latestAnalysis(props.view.connection);
		const found = latest.ok ? latest.data.proposal : undefined;
		if (found === undefined) return;
		proposal.value = found;
		ticked.value = new Set(
			screensOf(found)
				.filter((screen) => screen.ticked)
				.map((screen) => screen.relation),
		);
	} catch (error) {
		problem.value = api.failure(error).detail;
	}
}

async function build(): Promise<void> {
	if (proposal.value === null) return;
	building.value = true;
	problem.value = null;
	const result = await api.mapDatabase(
		mappingInput(proposal.value, ticked.value),
	);
	building.value = false;
	if (!result.ok) {
		problem.value = refusalText(result.error);
		return;
	}
	const page = result.data.resources.find((entry) => entry.page)?.page;
	if (page === undefined) onboarding.close();
	else onboarding.navigate(page.startsWith("/") ? page : `/${page}`);
}

function mockup(): void {
	onboarding.startConversation(
		databaseMockupPrompt(
			props.view.connection,
			props.view.module,
			chosen.value,
		),
	);
}

onMounted(load);
</script>

<template>
	<OnboardingFrame :lede="lede">
		<template #title>
			{{ t("dms_assistant.views.onboarding.analysis.title") }}
			<span class="text-primary">{{ view.connection }}</span>
		</template>
		<p
			v-if="proposal === null && problem === null"
			class="text-muted mt-5 text-sm"
		>
			{{ t("dms_assistant.views.onboarding.analysis.loading") }}
		</p>
		<div v-if="proposal" class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
			<section class="border-default rounded-xl border p-4">
				<h3
					class="text-muted mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
				>
					<UIcon name="i-ph-table" class="size-3.5" />
					{{ t("dms_assistant.views.onboarding.analysis.tables") }}
				</h3>
				<ul class="flex max-h-56 flex-col gap-2.5 overflow-y-auto">
					<li
						v-for="table in tables"
						:key="table.relation"
						class="text-highlighted flex items-center gap-2 text-[13px]"
					>
						<UIcon name="i-ph-rows" class="text-dimmed size-4 shrink-0" />
						<span class="min-w-0 flex-1 truncate">{{ table.relation }}</span>
						<span class="text-muted font-mono text-xs">
							{{ rows(table.rows) }}
						</span>
					</li>
				</ul>
			</section>
			<section class="border-default rounded-xl border p-4">
				<h3
					class="text-muted mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
				>
					<UIcon name="i-ph-layout" class="size-3.5" />
					{{ t("dms_assistant.views.onboarding.analysis.screens") }}
				</h3>
				<ul class="flex max-h-56 flex-col gap-2 overflow-y-auto">
					<li
						v-for="screen in screens"
						:key="screen.relation"
						class="flex items-center gap-2"
					>
						<UCheckbox
							:model-value="ticked.has(screen.relation)"
							:label="screen.title"
							:ui="{
								root: 'min-w-0 flex-1',
								label: 'truncate text-[13px] text-highlighted',
							}"
							@update:model-value="tick(screen.relation, $event === true)"
						/>
						<span class="text-muted shrink-0 text-xs">
							{{ t(KINDS[screen.kind]) }}
						</span>
					</li>
				</ul>
			</section>
		</div>
		<p v-if="problem" class="text-error mt-3 text-xs" role="alert">
			{{ problem }}
		</p>
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
				:label="t('dms_assistant.views.onboarding.analysis.build')"
				color="neutral"
				variant="outline"
				:disabled="chosen.length === 0"
				:loading="building"
				@click="build"
			/>
			<UButton
				:label="t('dms_assistant.views.onboarding.analysis.mockup')"
				icon="i-ph-frame-corners"
				color="secondary"
				:disabled="chosen.length === 0"
				@click="mockup"
			/>
		</template>
	</OnboardingFrame>
</template>
