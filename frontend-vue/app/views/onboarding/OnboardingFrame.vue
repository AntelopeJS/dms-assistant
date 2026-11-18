<script setup lang="ts">
import { useOnboarding } from "../../onboarding/runtime";

/**
 * One view of the onboarding popup: its heading, its content, then its footer under a rule. The
 * content scrolls inside the popup's height and the footer stays in view under it.
 */
defineProps<{ title?: string; lede?: string }>();

const onboarding = useOnboarding();
</script>

<template>
	<div
		class="flex min-h-0 flex-[1_1_19.5rem] flex-col overflow-y-auto px-6 pb-6"
		data-onboarding-body
	>
		<slot name="lead" />
		<h2
			v-if="title || $slots.title"
			class="text-highlighted text-balance text-[19px]/7 font-semibold tracking-tight"
		>
			<slot name="title">{{ title }}</slot>
		</h2>
		<p
			v-if="lede || $slots.lede"
			class="text-toned mt-1.5 max-w-[29rem] text-pretty text-sm/6"
		>
			<slot name="lede">{{ lede }}</slot>
		</p>
		<slot />
		<p
			v-if="onboarding.problem.value"
			class="text-error mt-4 text-xs"
			role="alert"
		>
			{{ onboarding.problem.value }}
		</p>
	</div>
	<div
		v-if="$slots.footer"
		class="min-h-15 border-default flex shrink-0 flex-wrap items-center gap-2 border-t px-5 py-3"
	>
		<slot name="footer" />
	</div>
</template>
