<script setup lang="ts">
import { computed } from "vue";
import type { ChartBlock } from "./spec";

interface Props {
	block: ChartBlock;
}

const props = defineProps<Props>();

const { t, locale } = useI18n();

/**
 * The chart is drawn here as SVG from the figures alone, with the theme's
 * chart colours: a charting library would read the model's labels as markup
 * in its legend and tooltips, this draws them as text nodes.
 */
const WIDTH = 640;
const HEIGHT = 280;
const PADDING = { top: 16, right: 16, bottom: 44, left: 56 };
const TICKS = 4;
const GROUP_GAP_RATIO = 0.25;
const MAX_LABELS = 12;
const LABEL_CHARS = 14;
const POINT_RADIUS = 3;
const CHART_COLORS = 5;

const plotWidth = WIDTH - PADDING.left - PADDING.right;
const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

interface Domain {
	min: number;
	max: number;
}

/** The value range, zero always in it, widened when every figure is zero. */
const domain = computed<Domain>(() => {
	const values = props.block.series.flatMap((series) => series.data);
	const min = Math.min(0, ...values);
	const max = Math.max(0, ...values);
	return min === max ? { min, max: min + 1 } : { min, max };
});

function y(value: number): number {
	const { min, max } = domain.value;
	return PADDING.top + ((max - value) / (max - min)) * plotHeight;
}

const ticks = computed(() => {
	const { min, max } = domain.value;
	return Array.from({ length: TICKS + 1 }, (_tick, index) => {
		const value = min + ((max - min) * index) / TICKS;
		return { value, y: y(value) };
	});
});

const tickFormat = computed(
	() =>
		new Intl.NumberFormat(locale.value, {
			notation: "compact",
			maximumFractionDigits: 1,
		}),
);

const groupWidth = computed(() => plotWidth / props.block.categories.length);

function categoryCentre(index: number): number {
	return PADDING.left + groupWidth.value * (index + 0.5);
}

interface Bar {
	x: number;
	y: number;
	width: number;
	height: number;
}

const bars = computed<Bar[][]>(() => {
	const seriesCount = props.block.series.length;
	const inner = groupWidth.value * (1 - GROUP_GAP_RATIO);
	const barWidth = inner / seriesCount;
	const zero = y(0);
	return props.block.series.map((series, seriesIndex) =>
		series.data.map((value, index) => {
			const top = y(value);
			return {
				x:
					PADDING.left +
					groupWidth.value * index +
					(groupWidth.value - inner) / 2 +
					barWidth * seriesIndex,
				y: Math.min(top, zero),
				width: barWidth,
				height: Math.abs(zero - top),
			};
		}),
	);
});

const lines = computed(() =>
	props.block.series.map((series) =>
		series.data.map((value, index) => ({
			x: categoryCentre(index),
			y: y(value),
		})),
	),
);

function points(line: { x: number; y: number }[]): string {
	return line.map((point) => `${point.x},${point.y}`).join(" ");
}

/** Every label when they fit, else one in n. */
const labelStep = computed(() =>
	Math.max(1, Math.ceil(props.block.categories.length / MAX_LABELS)),
);

function shortLabel(label: string): string {
	return label.length > LABEL_CHARS
		? `${label.slice(0, LABEL_CHARS - 1)}…`
		: label;
}

function colorOf(seriesIndex: number): string {
	return `var(--dms-chart-${(seriesIndex % CHART_COLORS) + 1})`;
}

const description = computed(() =>
	t("dms_assistant.views.artifacts.chart_label", {
		title: props.block.title ?? t("dms_assistant.views.artifacts.kind.chart"),
		series: props.block.series.map((series) => series.name).join(", "),
	}),
);
</script>

<template>
	<figure class="flex flex-col gap-2" data-artifact-chart>
		<figcaption
			v-if="block.title"
			class="text-highlighted text-[13px] font-semibold"
		>
			{{ block.title }}
		</figcaption>
		<svg
			:viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
			class="w-full"
			role="img"
			:aria-label="description"
			:data-chart-kind="block.kind"
		>
			<title>{{ description }}</title>
			<g v-for="(tick, index) in ticks" :key="index">
				<line
					:x1="PADDING.left"
					:x2="WIDTH - PADDING.right"
					:y1="tick.y"
					:y2="tick.y"
					stroke="var(--dms-chart-grid, currentColor)"
					stroke-opacity="0.4"
				/>
				<text
					:x="PADDING.left - 8"
					:y="tick.y"
					text-anchor="end"
					dominant-baseline="middle"
					class="fill-(--ui-text-dimmed) text-[11px] tabular-nums"
				>
					{{ tickFormat.format(tick.value) }}
				</text>
			</g>
			<template v-if="block.kind === 'bar'">
				<g
					v-for="(series, seriesIndex) in bars"
					:key="seriesIndex"
					:fill="colorOf(seriesIndex)"
				>
					<rect
						v-for="(bar, index) in series"
						:key="index"
						:x="bar.x"
						:y="bar.y"
						:width="bar.width"
						:height="bar.height"
						rx="2"
					/>
				</g>
			</template>
			<template v-else>
				<g
					v-for="(line, seriesIndex) in lines"
					:key="seriesIndex"
					:stroke="colorOf(seriesIndex)"
					:fill="colorOf(seriesIndex)"
				>
					<polyline
						:points="points(line)"
						fill="none"
						stroke-width="2"
						stroke-linejoin="round"
					/>
					<circle
						v-for="(point, index) in line"
						:key="index"
						:cx="point.x"
						:cy="point.y"
						:r="POINT_RADIUS"
					/>
				</g>
			</template>
			<g v-for="(category, index) in block.categories" :key="index">
				<text
					v-if="index % labelStep === 0"
					:x="categoryCentre(index)"
					:y="HEIGHT - PADDING.bottom + 18"
					text-anchor="middle"
					class="fill-(--ui-text-muted) text-[11px]"
				>
					{{ shortLabel(category) }}
				</text>
			</g>
		</svg>
		<ul
			class="text-muted flex flex-wrap gap-x-4 gap-y-1 text-[12px]"
			:aria-label="t('dms_assistant.views.artifacts.chart_series')"
		>
			<li
				v-for="(series, index) in block.series"
				:key="index"
				class="flex items-center gap-1.5"
			>
				<span
					class="inline-block size-2.5 rounded-[2.5px]"
					:style="{ background: colorOf(index) }"
					aria-hidden="true"
				/>
				{{ series.name }}
			</li>
		</ul>
	</figure>
</template>
