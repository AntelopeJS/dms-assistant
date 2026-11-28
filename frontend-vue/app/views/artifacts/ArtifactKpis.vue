<script setup lang="ts">
import type { ArtifactTone, KpiItem } from "./spec";

interface Props {
	items: KpiItem[];
}

defineProps<Props>();

const { locale } = useI18n();

const TONE_CLASSES: Record<ArtifactTone, string> = {
	neutral: "text-highlighted",
	success: "text-success",
	warning: "text-warning",
	error: "text-error",
	info: "text-info",
};

function valueText(value: KpiItem["value"]): string {
	return typeof value === "number"
		? new Intl.NumberFormat(locale.value).format(value)
		: value;
}
</script>

<template>
	<div
		class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
		data-artifact-kpis
	>
		<div
			v-for="(item, index) in items"
			:key="index"
			class="border-default bg-(--dms-bg-field) flex flex-col gap-1 rounded-md border px-3.5 py-3"
			data-artifact-kpi
		>
			<span
				class="text-dimmed font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]"
			>
				{{ item.label }}
			</span>
			<span
				class="text-[22px] font-[650] tabular-nums leading-tight"
				:class="TONE_CLASSES[item.tone ?? 'neutral']"
			>
				{{ valueText(item.value) }}
			</span>
			<span v-if="item.detail" class="text-muted text-[12px]">
				{{ item.detail }}
			</span>
		</div>
	</div>
</template>
