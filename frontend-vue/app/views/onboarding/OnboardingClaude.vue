<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import type { ClaudeTokenProblem } from "../../onboarding/contract";
import { useOnboarding } from "../../onboarding/runtime";
import { accountSummary } from "./login-text";
import OnboardingFrame from "./OnboardingFrame.vue";

/**
 * A long-lived token from `claude setup-token`, checked live against Anthropic as it is pasted;
 * Continue is offered once the backend found it works and saved it.
 */
type TokenPhase =
	| { kind: "idle" }
	| { kind: "checking" }
	| { kind: "ok"; who: string }
	| { kind: "failed"; reason: ClaudeTokenProblem };

const COMMAND = "claude setup-token";
const CHECK_DELAY_MS = 400;

const PROBLEMS: Record<ClaudeTokenProblem, string> = {
	rejected: "dms_ai.views.onboarding.claude.rejected",
	unreachable: "dms_ai.views.onboarding.claude.unreachable",
	malformed: "dms_ai.views.onboarding.claude.malformed",
	unsaved: "dms_ai.views.onboarding.claude.unsaved",
};

const onboarding = useOnboarding();
const { t } = useChatI18n();

const token = ref("");
const phase = ref<TokenPhase>({ kind: "idle" });
const copied = ref(false);
const busy = ref(false);
let checks = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const hint = computed(() => {
	const current = phase.value;
	if (current.kind === "checking") {
		return {
			tone: "text-muted",
			text: t("dms_ai.views.onboarding.claude.checking"),
		};
	}
	if (current.kind === "ok") {
		return {
			tone: "text-success",
			text: t("dms_ai.views.onboarding.claude.connected", {
				who: current.who,
			}),
		};
	}
	if (current.kind === "failed") {
		return { tone: "text-error", text: t(PROBLEMS[current.reason]) };
	}
	return null;
});

const STATUS_ICONS: Record<
	Exclude<TokenPhase["kind"], "idle">,
	{ name: string; tone: string }
> = {
	checking: { name: "i-ph-circle-notch", tone: "animate-spin text-dimmed" },
	ok: { name: "i-ph-check-circle-fill", tone: "text-success" },
	failed: { name: "i-ph-warning-circle-fill", tone: "text-error" },
};

const statusIcon = computed(() =>
	phase.value.kind === "idle" ? null : STATUS_ICONS[phase.value.kind],
);

async function check(value: string): Promise<void> {
	checks += 1;
	const mine = checks;
	const answer = await onboarding.checkClaudeToken(value);
	if (mine !== checks) return;
	phase.value = answer.ok
		? { kind: "ok", who: accountSummary("claude", answer) }
		: { kind: "failed", reason: answer.reason };
}

function edit(value: string): void {
	token.value = value;
	if (timer !== undefined) clearTimeout(timer);
	checks += 1;
	const trimmed = value.trim();
	if (trimmed === "") {
		phase.value = { kind: "idle" };
		return;
	}
	phase.value = { kind: "checking" };
	timer = setTimeout(() => void check(trimmed), CHECK_DELAY_MS);
}

async function copy(): Promise<void> {
	await navigator.clipboard?.writeText(COMMAND).catch(() => undefined);
	copied.value = true;
}

async function proceed(): Promise<void> {
	busy.value = true;
	await onboarding.confirmLogin("claude");
	busy.value = false;
}

onBeforeUnmount(() => {
	if (timer !== undefined) clearTimeout(timer);
});
</script>

<template>
	<OnboardingFrame
		:title="t('dms_ai.views.onboarding.claude.title')"
		:lede="t('dms_ai.views.onboarding.claude.lede')"
	>
		<template #lead>
			<UBadge
				class="mb-1 self-start"
				color="neutral"
				variant="soft"
				size="sm"
				label="Claude"
			/>
		</template>
		<ol class="mt-5 flex flex-col gap-4">
			<li class="flex gap-3.5">
				<span
					class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold"
					:class="
						copied
							? 'border-success/40 bg-success/10 text-success'
							: 'border-default bg-elevated text-muted'
					"
					aria-hidden="true"
				>
					<UIcon v-if="copied" name="i-ph-check-bold" class="size-3" />
					<template v-else>1</template>
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-highlighted mb-2 text-[13px] font-semibold">
						{{ t("dms_ai.views.onboarding.claude.run") }}
					</p>
					<div
						class="border-default bg-elevated/60 text-highlighted flex h-10 items-center gap-2 rounded-lg border pe-1.5 ps-3 font-mono text-[13px]"
					>
						<span class="text-dimmed" aria-hidden="true">$</span>
						<code class="flex-1">{{ COMMAND }}</code>
						<UButton
							size="xs"
							color="neutral"
							variant="soft"
							:icon="copied ? 'i-ph-check-bold' : 'i-ph-copy'"
							:label="
								copied
									? t('dms_ai.views.onboarding.claude.copied')
									: t('dms_ai.views.onboarding.claude.copy')
							"
							@click="copy"
						/>
					</div>
				</div>
			</li>
			<li class="flex gap-3.5">
				<span
					class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold"
					:class="
						phase.kind === 'ok'
							? 'border-success/40 bg-success/10 text-success'
							: 'border-default bg-elevated text-muted'
					"
					aria-hidden="true"
				>
					<UIcon
						v-if="phase.kind === 'ok'"
						name="i-ph-check-bold"
						class="size-3"
					/>
					<template v-else>2</template>
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-highlighted mb-2 text-[13px] font-semibold">
						{{ t("dms_ai.views.onboarding.claude.paste") }}
					</p>
					<UInput
						:model-value="token"
						placeholder="sk-ant-oat01-…"
						autocomplete="off"
						spellcheck="false"
						size="lg"
						class="w-full"
						:color="
							phase.kind === 'ok'
								? 'success'
								: phase.kind === 'failed'
									? 'error'
									: 'primary'
						"
						:highlight="phase.kind === 'ok' || phase.kind === 'failed'"
						:ui="{ base: 'font-mono text-[13px]' }"
						data-token
						@update:model-value="edit(String($event))"
					>
						<template v-if="statusIcon" #trailing>
							<UIcon
								:name="statusIcon.name"
								:class="['size-4', statusIcon.tone]"
							/>
						</template>
					</UInput>
					<p
						v-if="hint"
						class="mt-2 text-xs"
						:class="hint.tone"
						aria-live="polite"
						data-token-hint
					>
						{{ hint.text }}
					</p>
				</div>
			</li>
		</ol>
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
				:label="t('dms_ai.views.onboarding.proceed')"
				trailing-icon="i-ph-arrow-right"
				:disabled="phase.kind !== 'ok'"
				:loading="busy"
				data-continue
				@click="proceed"
			/>
		</template>
	</OnboardingFrame>
</template>
