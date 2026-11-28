<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { z } from "zod";
import { useDmsRoute } from "#dms/frontend-module";
import ArtifactPanel from "../views/artifacts/ArtifactPanel.vue";
import UnavailableState from "../views/UnavailableState.vue";
import { useAiPagedData } from "../views/composables/useAiData";
import { useAssistant } from "../views/composables/useAssistant";
import { useViewFormat } from "../views/composables/useViewFormat";
import {
	AI_ROUTES,
	ARTIFACT_QUERY_KEY,
	ARTIFACTS_PAGE_SIZE,
} from "../views/constants";
import type {
	ArtifactKind,
	ArtifactSummary,
	ListPayload,
} from "../views/types";
import { artifactIcon, writeSelectedArtifact } from "../views/utils/artifacts";

type KindFilter = ArtifactKind | "all";
type ArtifactsPage = ListPayload<ArtifactSummary>;

const { t } = useI18n();
const { moment } = useViewFormat();
const assistant = useAssistant();
const route = useDmsRoute();

const kind = ref<KindFilter>("all");
const search = ref("");

/** The list query: the page, the kind as a column filter, and the search the sidecar runs over titles and summaries. */
function listQuery(offset: number): Record<string, string | number> {
	const query: Record<string, string | number> = {
		offset,
		limit: ARTIFACTS_PAGE_SIZE,
	};
	const needle = search.value.trim();
	if (needle !== "") query.search = needle;
	if (kind.value !== "all") query.filter_kind = `is:${kind.value}`;
	return query;
}

/** The artifacts the pages hold, in order. */
function loadedCount(pages: ArtifactsPage[]): number {
	return pages.reduce((count, page) => count + page.results.length, 0);
}

/**
 * The list's first page is read with the page: a server render shows it and
 * the selected artifact at once. "Load more" appends a page under the
 * filter's key; the page's refreshes read every page loaded again.
 */
const list = useAiPagedData<ArtifactsPage, number>(
	() => `dms-assistant:artifacts:${kind.value}:${search.value.trim()}`,
	({ $authFetch, cursor, signal }) =>
		$authFetch<ArtifactsPage>(AI_ROUTES.artifacts, {
			query: listQuery(cursor ?? 0),
			signal,
		}),
	{
		nextCursor: (page, pages) => {
			const loaded = loadedCount(pages);
			return page.results.length > 0 && loaded < page.total ? loaded : null;
		},
	},
);
const artifacts = computed(() =>
	list.pages.value.flatMap((page) => page.results),
);
const total = computed(() => list.pages.value.at(-1)?.total ?? 0);

const ROUTE_ID_SCHEMA = z.string().min(1);

function selectedFromRoute(): string | undefined {
	const id = ROUTE_ID_SCHEMA.safeParse(route.query[ARTIFACT_QUERY_KEY]);
	return id.success ? id.data : undefined;
}

/** The artifact picked here or named by the URL (`?artifact=`, as the assistant's link opens it); the first one until then. */
const pickedId = ref<string | undefined>(selectedFromRoute());
const selectedId = computed(() => pickedId.value ?? artifacts.value[0]?.id);

watch(selectedFromRoute, (id) => {
	if (id) pickedId.value = id;
});

function select(id: string | number | undefined): void {
	if (id === undefined) return;
	pickedId.value = String(id);
	writeSelectedArtifact(pickedId.value);
}

/** The deleted artifact leaves the selection and the URL; the list reads again. */
function onDeleted(): void {
	pickedId.value = undefined;
	writeSelectedArtifact(undefined);
	void list.refresh();
}

const KIND_ITEMS = computed(() => [
	{ value: "all", label: t("dms_assistant.views.artifacts.filter_all") },
	{ value: "report", label: t("dms_assistant.views.artifacts.kind.report") },
	{ value: "table", label: t("dms_assistant.views.artifacts.kind.table") },
	{ value: "chart", label: t("dms_assistant.views.artifacts.kind.chart") },
]);

function sublabel(artifact: ArtifactSummary): string {
	const parts = [
		t(`dms_assistant.views.artifacts.kind.${artifact.kind}`),
		moment(artifact.createdAtMs),
	];
	if (artifact.createdBy) parts.push(artifact.createdBy);
	return parts.join(" · ");
}

const items = computed(() =>
	artifacts.value.map((artifact) => ({
		value: artifact.id,
		label: artifact.title,
		sublabel: sublabel(artifact),
		icon: artifactIcon(artifact.kind),
	})),
);

const isFiltered = computed(
	() => kind.value !== "all" || search.value.trim() !== "",
);
const isFirstLoad = computed(
	() =>
		artifacts.value.length === 0 &&
		(list.pending.value || list.status.value === "idle"),
);
const hasMore = computed(() => list.hasMore.value);
const listLabel = computed(() =>
	t("dms_assistant.views.artifacts.list_label", { count: total.value }),
);
const emptyActions = computed(() =>
	assistant.isAvailable
		? [
				{
					label: t("dms_assistant.views.common.open_assistant"),
					icon: "i-ph-sparkle",
					color: "secondary" as const,
					onClick: () => assistant.openPanel(),
				},
			]
		: [],
);

function reload(): Promise<void> {
	return list.refresh();
}

/** Appends the next page; a failure keeps the artifacts listed and the button. */
function loadMore(): Promise<void> {
	return list.loadMore();
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<UInput
				v-model="search"
				icon="i-ph-magnifying-glass"
				size="sm"
				class="w-full sm:w-64"
				:placeholder="t('dms_assistant.views.artifacts.search')"
				:aria-label="t('dms_assistant.views.artifacts.search')"
			/>
			<DmsSegmentedControl
				v-model="kind"
				:items="KIND_ITEMS"
				size="sm"
				:aria-label="t('dms_assistant.views.artifacts.filter_label')"
			/>
		</div>

		<DmsCardPanel
			v-if="list.failure.value && artifacts.length === 0"
			:padded="false"
		>
			<UnavailableState
				:failure="list.failure.value"
				:message="list.message.value"
				@retry="reload"
			/>
		</DmsCardPanel>
		<div
			v-else-if="isFirstLoad"
			class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_minmax(0,1fr)]"
			:aria-busy="true"
			:aria-label="t('dms_assistant.views.common.loading')"
		>
			<DmsCardPanel class="flex flex-col gap-4">
				<USkeleton v-for="index in 5" :key="index" class="h-10 w-full" />
			</DmsCardPanel>
			<DmsCardPanel class="flex flex-col gap-3">
				<USkeleton class="h-5 w-64" />
				<USkeleton class="h-48 w-full" />
			</DmsCardPanel>
		</div>
		<DmsCardPanel
			v-else-if="artifacts.length === 0 && !isFiltered"
			:padded="false"
		>
			<DmsEmptyState
				icon="i-ph-presentation-chart"
				:title="t('dms_assistant.views.artifacts.empty_title')"
				:description="t('dms_assistant.views.artifacts.empty_description')"
				:actions="emptyActions"
			/>
		</DmsCardPanel>
		<DmsCardPanel v-else-if="artifacts.length === 0" :padded="false">
			<DmsEmptyState
				variant="no-result"
				:title="t('dms_assistant.views.artifacts.no_match_title')"
				:description="t('dms_assistant.views.artifacts.no_match_description')"
			/>
		</DmsCardPanel>
		<template v-else>
			<DmsMasterDetail
				:model-value="selectedId"
				:items="items"
				:list-label="listLabel"
				@update:model-value="select"
			>
				<ArtifactPanel
					v-if="selectedId"
					:key="selectedId"
					:artifact-id="selectedId"
					@deleted="onDeleted"
				/>
			</DmsMasterDetail>
			<div v-if="hasMore" class="flex lg:w-[380px] lg:justify-center">
				<UButton
					color="neutral"
					variant="outline"
					size="sm"
					icon="i-ph-caret-down"
					:loading="list.loadingMore.value"
					:label="t('dms_assistant.views.common.load_more')"
					@click="loadMore"
				/>
			</div>
		</template>
	</div>
</template>
