<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAiData } from "../views/composables/useAiData";
import { AI_ROUTES } from "../views/constants";
import type { ExclusionCandidates } from "../views/types";

interface Props {
	onSuccessCallback?: () => void;
}

const props = withDefaults(defineProps<Props>(), {
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
const field = ref<string>();
const isSaving = ref(false);

const pages = computed(() => candidates.data.value?.pages ?? []);
const page = computed(() => pages.value.find((p) => p.path === pagePath.value));
const tables = computed(() => page.value?.tables ?? []);
const table = computed(() => tables.value.find((c) => c.id === tableId.value));
const columns = computed(() => table.value?.columns ?? []);

const pageItems = computed(() =>
	pages.value.map((p) => ({ label: p.title, value: p.path })),
);
const tableItems = computed(() =>
	tables.value.map((c) => ({ label: c.title, value: c.id })),
);
const columnItems = computed(() =>
	columns.value.map((c) => ({ label: c.header, value: c.field })),
);

watch(pagePath, () => {
	tableId.value = tables.value.length === 1 ? tables.value[0]?.id : undefined;
});
watch([pagePath, tableId], () => {
	field.value = undefined;
});

async function add(): Promise<void> {
	if (!table.value || !field.value) return;
	isSaving.value = true;
	try {
		await $authFetch(AI_ROUTES.exclusions, {
			method: "POST",
			body: { route: table.value.route, field: field.value },
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
		<UFormField :label="t('dms_ai.views.exclusions.column')">
			<USelectMenu
				v-model="field"
				:items="columnItems"
				value-key="value"
				:disabled="!table"
				class="w-full"
			/>
		</UFormField>
		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="i-ph-eye-slash"
				:label="t('dms_ai.views.exclusions.add')"
				:disabled="!field"
				:loading="isSaving"
				@click="add"
			/>
		</div>
	</div>
</template>
