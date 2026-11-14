<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { blockOutlineRect, type OutlineRect } from "../utils/block-outline";

interface Props {
	/** The layout path of the block being changed, `null` when none is. */
	path: string | null;
}

const props = defineProps<Props>();

const rect = ref<OutlineRect | null>(null);
let frame: number | null = null;

function isSameRect(a: OutlineRect | null, b: OutlineRect | null): boolean {
	if (a === null || b === null) return a === b;
	return (
		a.top === b.top &&
		a.left === b.left &&
		a.width === b.width &&
		a.height === b.height
	);
}

function measure(): void {
	if (props.path === null) return;
	const next = blockOutlineRect(document, props.path);
	if (!isSameRect(rect.value, next)) rect.value = next;
	frame = requestAnimationFrame(measure);
}

function stopMeasuring(): void {
	if (frame !== null) cancelAnimationFrame(frame);
	frame = null;
}

watch(
	() => props.path,
	(path) => {
		stopMeasuring();
		if (path === null) {
			rect.value = null;
			return;
		}
		measure();
	},
	{ immediate: true },
);

onUnmounted(stopMeasuring);

const style = computed(() =>
	rect.value === null
		? undefined
		: {
				top: `${rect.value.top}px`,
				left: `${rect.value.left}px`,
				width: `${rect.value.width}px`,
				height: `${rect.value.height}px`,
			},
);
</script>

<template>
	<Teleport to="body">
		<Transition name="dms-assistant-outline">
			<div
				v-if="style"
				class="dms-assistant-chat-tokens dms-assistant-outline"
				:style="style"
				aria-hidden="true"
			/>
		</Transition>
	</Teleport>
</template>

<style scoped>
.dms-assistant-outline {
	position: fixed;
	z-index: 30;
	border-radius: 12px;
	box-shadow:
		0 0 0 2px var(--ai),
		0 0 0 6px var(--ai-tint);
	pointer-events: none;
	transition:
		top 160ms ease,
		left 160ms ease,
		width 160ms ease,
		height 160ms ease;
}

.dms-assistant-outline-enter-active,
.dms-assistant-outline-leave-active {
	transition: opacity 200ms ease;
}

.dms-assistant-outline-enter-from,
.dms-assistant-outline-leave-to {
	opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
	.dms-assistant-outline,
	.dms-assistant-outline-enter-active,
	.dms-assistant-outline-leave-active {
		transition: none;
	}
}
</style>
