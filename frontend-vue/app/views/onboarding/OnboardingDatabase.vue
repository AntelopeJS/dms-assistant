<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useBuilderApi } from "../../../builder/app/runtime/api";
import {
	type DatabaseEngine,
	ENGINES,
	engineOfScheme,
} from "../../../builder/app/runtime/database-connect";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import {
	type UrlProblem,
	useDatabaseConnect,
} from "../../onboarding/connect-database";
import type {
	CheckStatus,
	ConnectCheck,
} from "../../onboarding/database-checks";
import { useOnboarding } from "../../onboarding/runtime";
import OnboardingFrame from "./OnboardingFrame.vue";

/**
 * "Start from an existing database": the engine, one connection URL, then the live checks while
 * the connection is written into the project and analysed. The analysis opens once it is ready.
 */
const ENGINE_ICONS: Record<DatabaseEngine, string> = {
	postgres: "i-ph-elephant",
	mongodb: "i-ph-leaf",
	rethinkdb: "i-ph-circles-three",
};

const PLACEHOLDERS: Record<DatabaseEngine, string> = {
	postgres: "postgres://user:password@host:5432/shop",
	mongodb: "mongodb://user:password@host:27017/shop",
	rethinkdb: "rethinkdb://user:password@host:28015/shop",
};

const STATUS_ICONS: Record<CheckStatus, { name: string; tone: string }> = {
	pending: { name: "i-ph-circle", tone: "text-dimmed" },
	running: { name: "i-ph-circle-notch", tone: "animate-spin text-primary" },
	done: { name: "i-ph-check-bold", tone: "text-success" },
	failed: { name: "i-ph-x-bold", tone: "text-error" },
};

const STATUS_TONES: Record<CheckStatus, string> = {
	pending: "text-dimmed",
	running: "text-primary",
	done: "text-success",
	failed: "text-error",
};

const ENGINE_LIST = Object.keys(ENGINES).filter(
	(engine): engine is DatabaseEngine => engine in ENGINE_ICONS,
);

const onboarding = useOnboarding();
const { t } = useChatI18n();
const database = useDatabaseConnect(useBuilderApi());

const engine = ref<DatabaseEngine>("postgres");
const url = ref("");
const urlProblem = ref<UrlProblem | null>(null);

const submitted = computed(() => database.phase.value.kind !== "form");
const stuck = computed(() =>
	database.checks.value.some((check) => check.status === "failed"),
);
const busy = computed(() => submitted.value && !stuck.value);

function checkText(check: ConnectCheck): string {
	switch (check.key) {
		case "reachable":
			if (check.status === "running") {
				return t("dms_ai.views.onboarding.database.reachable_running");
			}
			if (check.status === "failed") {
				return t("dms_ai.views.onboarding.database.unreachable", {
					error: check.error ?? "",
				});
			}
			return check.latencyMs === undefined
				? t("dms_ai.views.onboarding.database.reachable")
				: t("dms_ai.views.onboarding.database.reachable_latency", {
						ms: check.latencyMs,
					});
		case "signed-in":
			return check.user === undefined
				? t("dms_ai.views.onboarding.database.signed_in_pending")
				: t("dms_ai.views.onboarding.database.signed_in", { user: check.user });
		case "read":
			return t("dms_ai.views.onboarding.database.read");
		case "schema":
			if (check.problem === "empty") {
				return t("dms_ai.views.onboarding.database.empty");
			}
			if (check.problem === "gave-up") {
				return t("dms_ai.views.onboarding.database.gave_up");
			}
			if (check.problem === "failed") {
				return t("dms_ai.views.onboarding.database.schema_failed", {
					error: check.error ?? "",
				});
			}
			return check.status === "done"
				? t("dms_ai.views.onboarding.database.schema_done")
				: t("dms_ai.views.onboarding.database.schema_running");
	}
}

const urlHint = computed(() => {
	const problem = urlProblem.value;
	if (problem === null) return null;
	if (problem.kind === "invalid") return problem.message;
	if (problem.kind === "no-database") {
		return t("dms_ai.views.onboarding.database.no_database");
	}
	if (problem.kind === "no-name") {
		return t("dms_ai.views.onboarding.database.no_name");
	}
	return t("dms_ai.views.onboarding.database.unreadable", {
		engine: ENGINES[engine.value].label,
	});
});

function editUrl(value: string): void {
	url.value = value;
	urlProblem.value = null;
	const scheme = /^([a-z]+):\/\//i.exec(value.trim())?.[1];
	const detected = scheme === undefined ? undefined : engineOfScheme(scheme);
	if (detected !== undefined) engine.value = detected;
}

async function connect(): Promise<void> {
	urlProblem.value = await database.connect(engine.value, url.value);
}

watch(database.phase, (phase) => {
	if (phase.kind !== "analysed") return;
	onboarding.send({
		type: "analysed",
		connection: phase.connection,
		module: phase.module,
	});
});
</script>

<template>
	<OnboardingFrame
		:title="t('dms_ai.views.onboarding.database.title')"
		:lede="t('dms_ai.views.onboarding.database.lede')"
	>
		<div class="mt-5 flex flex-wrap gap-2" role="radiogroup">
			<UButton
				v-for="option in ENGINE_LIST"
				:key="option"
				role="radio"
				:aria-checked="engine === option"
				:icon="ENGINE_ICONS[option]"
				:label="ENGINES[option].label"
				size="sm"
				:color="engine === option ? 'primary' : 'neutral'"
				:variant="engine === option ? 'soft' : 'outline'"
				:class="engine === option && 'ring-primary ring-1 ring-inset'"
				:disabled="busy"
				@click="engine = option"
			/>
		</div>
		<UFormField
			:label="t('dms_ai.views.onboarding.database.url')"
			class="mt-4"
			:error="urlHint ?? false"
		>
			<UInput
				:model-value="url"
				:placeholder="PLACEHOLDERS[engine]"
				autocomplete="off"
				spellcheck="false"
				size="lg"
				class="w-full"
				:disabled="busy"
				:ui="{ base: 'font-mono text-[13px]' }"
				@update:model-value="editUrl(String($event))"
				@keydown.enter="url.trim() && !busy && connect()"
			/>
		</UFormField>
		<ul
			v-if="database.checks.value.length > 0"
			class="mt-4 flex flex-col gap-1.5 text-[13px]"
			aria-live="polite"
		>
			<li
				v-for="check in database.checks.value"
				:key="check.key"
				class="flex items-start gap-2"
				:class="STATUS_TONES[check.status]"
				:data-check="check.key"
				:data-status="check.status"
			>
				<UIcon
					:name="STATUS_ICONS[check.status].name"
					class="mt-0.5 size-3.5 shrink-0"
					:class="STATUS_ICONS[check.status].tone"
				/>
				{{ checkText(check) }}
			</li>
		</ul>
		<p
			v-if="database.refusal.value"
			class="text-error mt-3 text-xs"
			role="alert"
		>
			{{ database.refusal.value }}
		</p>
		<p class="text-dimmed mt-4 flex items-center gap-1.5 text-xs">
			<UIcon name="i-ph-lock-simple" class="size-3.5 shrink-0" />
			{{ t("dms_ai.views.onboarding.database.stored") }}
		</p>
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
				:label="t('dms_ai.views.onboarding.database.connect')"
				trailing-icon="i-ph-arrow-right"
				:disabled="url.trim() === '' || busy"
				:loading="busy"
				@click="connect"
			/>
		</template>
	</OnboardingFrame>
</template>
