<script setup lang="ts">
import { useTemplateRef, watchPostEffect } from "vue";

const props = defineProps<{
	/** Sanitized nodes, shown as a clone whenever a new fragment arrives. */
	fragment: DocumentFragment;
}>();

const host = useTemplateRef<HTMLDivElement>("host");

watchPostEffect(() => {
	host.value?.replaceChildren(props.fragment.cloneNode(true));
});
</script>

<template>
	<div ref="host" />
</template>
