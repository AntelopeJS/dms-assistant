<script setup lang="ts">
import { useOnboarding } from "../../onboarding/runtime";

/** One view of the onboarding popup: its heading, its content, then its footer under a rule. */
defineProps<{ title?: string; lede?: string }>();

const onboarding = useOnboarding();
</script>

<template>
	<div class="flex min-h-[19.5rem] flex-col px-6 pb-6">
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
		class="min-h-15 border-default flex flex-wrap items-center gap-2 border-t px-5 py-3"
	>
		<slot name="footer" />
	</div>
</template>
