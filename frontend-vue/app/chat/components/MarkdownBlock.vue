<script setup lang="ts">
import { useTemplateRef, watchPostEffect } from "vue";

const props = defineProps<{
	/** Sanitized nodes, shown as a clone whenever a new fragment arrives; nothing until one does. */
	fragment: DocumentFragment | null;
}>();

const host = useTemplateRef<HTMLDivElement>("host");

watchPostEffect(() => {
	const nodes = props.fragment === null ? [] : [props.fragment.cloneNode(true)];
	host.value?.replaceChildren(...nodes);
});
</script>

<template>
	<div ref="host" />
</template>
