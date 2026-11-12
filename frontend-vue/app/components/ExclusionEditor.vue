<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAiData } from "../views/composables/useAiData";
import { AI_ROUTES } from "../views/constants";
import type { ExclusionCandidates } from "../views/types";

interface Props {
	rowData?: { route?: string };
	onSuccessCallback?: () => void;
}

const props = withDefaults(defineProps<Props>(), {
	rowData: undefined,
	onSuccessCallback: undefined,
});

const { t } = useI18n();
const { $authFetch } = useAuthFetch();
const { presentError } = useApiErrorPresenter();

const candidates = useAiData<ExclusionCandidates>(
	AI_ROUTES.exclusionCandidates,
);

const pagePath = ref<string>();
const tableId = ref<string>();
const excluded = ref(new Set<string>());
const isSaving = ref(false);

const editedRoute = computed(() => props.rowData?.route);
const pages = computed(() => candidates.data.value?.pages ?? []);
const page = computed(() => pages.value.find((p) => p.path === pagePath.value));
const tables = computed(() => page.value?.tables ?? []);
const table = computed(() => tables.value.find((c) => c.id === tableId.value));
const route = computed(() => editedRoute.value ?? table.value?.route);
const checklist = computed(() =>
	candidates.data.value?.routes.find((r) => r.route === route.value),
);
const loadFailure = computed(() => {
	if (!candidates.failure.value) return undefined;
	return candidates.message.value || t("dms_ai.views.exclusions.load_failed");
});
const isSavable = computed(
	() => route.value !== undefined && checklist.value !== undefined,
);
const isExisting = computed(
	() => checklist.value?.fields.some((f) => f.isExcluded) ?? false,
);

const pageItems = computed(() =>
	pages.value.map((p) => ({ label: p.title, value: p.path })),
);
const tableItems = computed(() =>
	tables.value.map((c) => ({ label: c.title, value: c.id })),
);

watch(pagePath, () => {
	tableId.value = tables.value.length === 1 ? tables.value[0]?.id : undefined;
});
watch(
	checklist,
	(current) => {
		excluded.value = new Set(
			current?.fields.filter((f) => f.isExcluded).map((f) => f.field),
		);
	},
	{ immediate: true },
);

function setExcluded(field: string, isExcluded: boolean | "indeterminate") {
	const next = new Set(excluded.value);
	if (isExcluded === true) next.add(field);
	else next.delete(field);
	excluded.value = next;
}

async function save(): Promise<void> {
	if (!isSavable.value || !route.value) return;
	isSaving.value = true;
	try {
		await $authFetch(AI_ROUTES.exclusions, {
			method: "PUT",
			body: { route: route.value, fields: [...excluded.value] },
		});
		props.onSuccessCallback?.();
	} catch (error) {
		presentError(error, { fallbackKey: "dms_ai.views.exclusions.failed" });
	} finally {
		isSaving.value = false;
	}
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<p v-if="loadFailure" class="text-error text-sm">{{ loadFailure }}</p>
		<template v-if="!editedRoute">
			<p
				v-if="candidates.data.value && pages.length === 0"
				class="text-muted text-sm"
			>
				{{ t("dms_ai.views.exclusions.none") }}
			</p>
			<UFormField :label="t('dms_ai.views.exclusions.page')">
				<USelectMenu
					v-model="pagePath"
					:items="pageItems"
					value-key="value"
					:loading="candidates.pending.value"
					class="w-full"
				/>
			</UFormField>
			<UFormField :label="t('dms_ai.views.exclusions.table')">
				<USelectMenu
					v-model="tableId"
					:items="tableItems"
					value-key="value"
					:disabled="!page"
					class="w-full"
				/>
			</UFormField>
		</template>
		<template v-if="route">
			<p class="text-sm">
				<span class="text-muted">{{ t("dms_ai.views.exclusions.route") }}</span>
				<code class="ms-2">{{ route }}</code>
			</p>
			<p v-if="!editedRoute && isExisting" class="text-muted text-sm">
				{{ t("dms_ai.views.exclusions.existing") }}
			</p>
			<ul class="flex flex-col gap-2">
				<li
					v-for="item in checklist?.fields ?? []"
					:key="item.field"
					class="flex items-center gap-2"
				>
					<UIcon
						:name="excluded.has(item.field) ? 'i-ph-eye-slash' : 'i-ph-eye'"
						:class="excluded.has(item.field) ? 'text-warning' : 'text-dimmed'"
					/>
					<UCheckbox
						:model-value="excluded.has(item.field)"
						:label="item.header"
						:description="item.header === item.field ? undefined : item.field"
						@update:model-value="setExcluded(item.field, $event)"
					/>
					<UBadge
						v-if="!item.isShown"
						:label="t('dms_ai.views.exclusions.not_found')"
						color="warning"
						variant="subtle"
						size="sm"
					/>
				</li>
			</ul>
		</template>
		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="i-ph-eye-slash"
				:label="t('dms_ai.views.exclusions.save')"
				:disabled="!isSavable"
				:loading="isSaving"
				@click="save"
			/>
		</div>
	</div>
</template>
