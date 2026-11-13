<script setup lang="ts">
import { computed, ref } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import type { OnboardingView } from "../../onboarding/flow";
import { useOnboarding } from "../../onboarding/runtime";
import OnboardingFrame from "./OnboardingFrame.vue";
import ProviderMark from "./ProviderMark.vue";

/**
 * The ChatGPT sign-in for Codex. OpenAI sends the browser back to the sidecar's loopback address,
 * which completes the sign-in by itself on the machine running the DMS, while the popup polls for
 * it; a browser elsewhere lands on a page that fails to load, whose address is pasted instead.
 */
const props = defineProps<{
	view: Extract<OnboardingView, { kind: "codex" }>;
}>();

/** Where OpenAI sends the browser back: the sidecar's loopback callback. */
const CALLBACK_PREFIX = "http://127.0.0.1:";

const onboarding = useOnboarding();
const { t } = useChatI18n();

const pasted = ref("");
const problem = ref<string | null>(null);
const busy = ref(false);

const canStart = computed(
	() => onboarding.state.value?.codexLoginUrl !== undefined,
);

async function connect(): Promise<void> {
	busy.value = true;
	problem.value = await onboarding.finishCodexSignIn(pasted.value.trim());
	busy.value = false;
}

function remote(): void {
	onboarding.send({ type: "codex", mode: "remote" });
}

const isRemote = computed(() => props.view.mode === "remote");
</script>

<template>
	<OnboardingFrame :title="t('dms_ai.views.onboarding.codex.title')">
		<template #lead>
			<UBadge
				class="mb-1 self-start"
				color="neutral"
				variant="soft"
				size="sm"
				label="Codex"
			/>
		</template>
		<template #lede>
			{{
				isRemote
					? t("dms_ai.views.onboarding.codex.remote_lede")
					: t("dms_ai.views.onboarding.codex.lede")
			}}
		</template>

		<div v-if="isRemote" class="mt-5">
			<UInput
				v-model="pasted"
				:placeholder="`${CALLBACK_PREFIX}…/auth/chatgpt/callback?code=…`"
				autocomplete="off"
				spellcheck="false"
				size="lg"
				class="w-full"
				:color="problem ? 'error' : 'primary'"
				:highlight="problem !== null"
				:ui="{ base: 'font-mono text-[13px]' }"
				@keydown.enter="pasted.trim() && connect()"
			/>
			<p v-if="problem" class="text-error mt-2 text-xs" role="alert">
				{{ problem }}
			</p>
			<p v-else class="text-muted mt-2 text-xs">
				{{ t("dms_ai.views.onboarding.codex.remote_hint") }}
				<code class="font-mono">{{ CALLBACK_PREFIX }}</code>
			</p>
		</div>

		<div v-else class="mt-6 flex flex-col items-start gap-3">
			<template v-if="view.mode === 'waiting'">
				<p
					class="text-toned flex items-center gap-2 text-[13px]"
					aria-live="polite"
				>
					<span class="relative flex size-2">
						<span
							class="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none"
						/>
						<span class="bg-primary relative inline-flex size-2 rounded-full" />
					</span>
					{{ t("dms_ai.views.onboarding.codex.waiting") }}
				</p>
				<UButton
					:label="t('dms_ai.views.onboarding.codex.reopen')"
					variant="link"
					class="px-0"
					@click="onboarding.signInWithChatGpt()"
				/>
			</template>
			<template v-else>
				<UButton
					size="lg"
					color="neutral"
					variant="outline"
					:disabled="!canStart"
					@click="onboarding.signInWithChatGpt()"
				>
					<ProviderMark provider="codex" size="sm" />
					{{ t("dms_ai.views.onboarding.codex.start") }}
					<UIcon name="i-ph-arrow-square-out" class="text-dimmed size-4" />
				</UButton>
				<p v-if="!canStart" class="text-muted text-xs">
					{{ t("dms_ai.views.onboarding.codex.unavailable") }}
				</p>
			</template>
			<UButton
				:label="t('dms_ai.views.onboarding.codex.remote')"
				variant="link"
				class="px-0"
				@click="remote"
			/>
		</div>

		<template #footer>
			<UButton
				:label="t('dms_ai.views.onboarding.back')"
				icon="i-ph-arrow-left"
				color="neutral"
				variant="ghost"
				@click="onboarding.send({ type: 'back' })"
			/>
			<span class="flex-1" />
			<UButton
				v-if="isRemote"
				:label="t('dms_ai.views.onboarding.codex.connect')"
				trailing-icon="i-ph-arrow-right"
				:disabled="pasted.trim() === ''"
				:loading="busy"
				@click="connect"
			/>
		</template>
	</OnboardingFrame>
</template>
