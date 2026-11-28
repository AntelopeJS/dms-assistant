<script setup lang="ts">
import { computed } from "vue";
import type { ArtifactCell, TableBlock } from "./spec";

interface Props {
	block: TableBlock;
}

const props = defineProps<Props>();

const { t, locale } = useI18n();

/** Every row as one cell per column: a short row ends in empty cells, a long one loses its extra cells. */
const rows = computed(() =>
	props.block.rows.map((row) =>
		props.block.columns.map((_column, index) => row[index] ?? null),
	),
);

function cellText(cell: ArtifactCell): string {
	if (cell === null) return "";
	if (typeof cell === "boolean")
		return t(
			cell
				? "dms_assistant.views.artifacts.yes"
				: "dms_assistant.views.artifacts.no",
		);
	if (typeof cell === "number")
		return new Intl.NumberFormat(locale.value).format(cell);
	return cell;
}

function alignClass(index: number): string {
	return props.block.columns[index]?.align === "right"
		? "text-right tabular-nums"
		: "text-left";
}
</script>

<template>
	<div class="border-default overflow-x-auto rounded-md border">
		<table class="w-full text-[13px]" data-artifact-table>
			<caption
				v-if="block.caption"
				class="text-muted px-3 py-2 text-left text-[12px]"
			>
				{{ block.caption }}
			</caption>
			<thead>
				<tr class="bg-(--dms-bg-field)">
					<th
						v-for="(column, index) in block.columns"
						:key="index"
						scope="col"
						class="text-highlighted border-default border-b px-3 py-2 font-semibold"
						:class="alignClass(index)"
					>
						{{ column.label }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-if="rows.length === 0">
					<td
						:colspan="block.columns.length"
						class="text-muted px-3 py-3 text-center"
					>
						{{ t("dms_assistant.views.artifacts.table_empty") }}
					</td>
				</tr>
				<tr
					v-for="(row, rowIndex) in rows"
					:key="rowIndex"
					class="border-default border-b last:border-b-0"
				>
					<td
						v-for="(cell, cellIndex) in row"
						:key="cellIndex"
						class="text-toned px-3 py-1.5 align-top"
						:class="alignClass(cellIndex)"
					>
						{{ cellText(cell) }}
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
