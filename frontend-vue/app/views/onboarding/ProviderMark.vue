<script setup lang="ts">
import type { ProviderName } from "../../onboarding/contract";

/** The provider's mark in its brand colour: Anthropic's A, OpenAI's logo. */
defineProps<{ provider: ProviderName; size?: "sm" | "md" }>();
</script>

<template>
	<span
		class="grid shrink-0 place-items-center rounded-lg font-semibold"
		:class="[
			size === 'sm' ? 'size-7 text-xs' : 'size-8 text-sm',
			provider === 'claude'
				? 'bg-[#d97757]/12 text-[#d97757]'
				: 'bg-[#10a37f]/12 text-[#10a37f]',
		]"
		aria-hidden="true"
	>
		<template v-if="provider === 'claude'">A</template>
		<UIcon v-else name="i-ph-open-ai-logo" class="size-4" />
	</span>
</template>
