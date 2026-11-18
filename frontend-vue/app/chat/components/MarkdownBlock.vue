<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watchPostEffect } from "vue";
import { useChatI18n } from "../composables/useChatI18n";

const props = defineProps<{
	/** Sanitized nodes, shown as a clone whenever a new fragment arrives; nothing until one does. */
	fragment: DocumentFragment | null;
	/** Adds a copy button to each code block; off while the block is still streaming. */
	copyable?: boolean;
}>();

const COPIED_FOR_MS = 1_600;
const CHECK_MARK = "✓";

const { t } = useChatI18n();
const host = useTemplateRef<HTMLDivElement>("host");
let timers = new Set<ReturnType<typeof setTimeout>>();

function clearTimers(): void {
	for (const timer of timers) clearTimeout(timer);
	timers = new Set();
}

/**
 * Appends a copy button to a code block, after sanitising: the button is never
 * part of the HTML string. It copies the code as it was before the button.
 */
function addCopyButton(pre: HTMLPreElement): void {
	const code = pre.textContent ?? "";
	const copyLabel = t("dms_assistant.panel.copy_code");
	const copiedLabel = t("dms_assistant.common.copied");
	const button = document.createElement("button");
	button.type = "button";
	button.className = "chat-markdown-copy";
	button.textContent = copyLabel;
	button.setAttribute("aria-label", copyLabel);
	button.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(code);
		} catch {
			return;
		}
		button.textContent = `${CHECK_MARK} ${copiedLabel}`;
		button.setAttribute("aria-label", copiedLabel);
		const timer = setTimeout(() => {
			timers.delete(timer);
			button.textContent = copyLabel;
			button.setAttribute("aria-label", copyLabel);
		}, COPIED_FOR_MS);
		timers.add(timer);
	});
	pre.append(button);
}

watchPostEffect(() => {
	clearTimers();
	const nodes = props.fragment === null ? [] : [props.fragment.cloneNode(true)];
	host.value?.replaceChildren(...nodes);
	if (props.copyable === true) {
		for (const pre of host.value?.querySelectorAll("pre") ?? [])
			addCopyButton(pre);
	}
});

onBeforeUnmount(clearTimers);
</script>

<template>
	<div ref="host" />
</template>
