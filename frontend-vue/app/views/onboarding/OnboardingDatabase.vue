<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useBuilderApi } from "../../../builder/app/runtime/api";
import {
	type ConnectionAccess,
	type DatabaseEngine,
	ENGINES,
	engineOfScheme,
} from "../../../builder/app/runtime/database-connect";
import { useChatI18n } from "../../chat/composables/useChatI18n";
import {
	CONNECTABLE_ENGINES,
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
 * "Start from an existing database": the engine, one connection URL, then the live checks before
 * anything is written, the access when the account can write, and the analysis, which opens once
 * it is ready.
 */
const ENGINE_ICONS: Partial<Record<DatabaseEngine, string>> = {
	postgres: "i-ph-cylinder",
	mongodb: "i-ph-leaf",
	rethinkdb: "i-ph-circles-three",
};
const DEFAULT_ENGINE_ICON = "i-ph-database";

function placeholder(engine: DatabaseEngine): string {
	const { schemes, port } = ENGINES[engine];
	return `${schemes[0] ?? `${engine}:`}//user:password@host:${port}/shop`;
}

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

const ACCESS_OPTIONS: readonly {
	value: ConnectionAccess;
	icon: string;
	label: string;
	hint: string;
}[] = [
	{
		value: "read",
		icon: "i-ph-eye",
		label: "dms_ai.views.onboarding.database.access_read",
		hint: "dms_ai.views.onboarding.database.access_read_hint",
	},
	{
		value: "read-write",
		icon: "i-ph-pencil-simple",
		label: "dms_ai.views.onboarding.database.access_write",
		hint: "dms_ai.views.onboarding.database.access_write_hint",
	},
];

const onboarding = useOnboarding();
const { t } = useChatI18n();
const database = useDatabaseConnect(useBuilderApi());

const engine = ref<DatabaseEngine>("postgres");
const url = ref("");
const urlProblem = ref<UrlProblem | null>(null);
const access = ref<ConnectionAccess>("read");

const choosing = computed(() => database.phase.value.kind === "choosing");
const stuck = computed(() =>
	database.checks.value.some((check) => check.status === "failed"),
);
const busy = computed(
	() => database.phase.value.kind !== "form" && !choosing.value && !stuck.value,
);

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
			if (check.status === "failed") {
				return t("dms_ai.views.onboarding.database.signed_in_failed", {
					error: check.error ?? "",
				});
			}
			if (check.status !== "done") {
				return t("dms_ai.views.onboarding.database.signed_in_pending");
			}
			return check.user === undefined
				? t("dms_ai.views.onboarding.database.signed_in_no_user")
				: t("dms_ai.views.onboarding.database.signed_in", { user: check.user });
		case "read":
			if (check.status === "failed") {
				return t("dms_ai.views.onboarding.database.read_failed", {
					error: check.error ?? "",
				});
			}
			return check.canWrite
				? t("dms_ai.views.onboarding.database.read_write")
				: t("dms_ai.views.onboarding.database.read");
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

function pickEngine(option: DatabaseEngine): void {
	if (choosing.value) database.reset();
	engine.value = option;
}

function editUrl(value: string): void {
	if (choosing.value) database.reset();
	url.value = value;
	urlProblem.value = null;
	const scheme = /^([a-z]+):\/\//i.exec(value.trim())?.[1];
	const detected = scheme === undefined ? undefined : engineOfScheme(scheme);
	if (detected !== undefined) engine.value = detected;
}

async function connect(): Promise<void> {
	if (choosing.value) {
		await database.choose(access.value);
		return;
	}
	urlProblem.value = await database.connect(engine.value, url.value);
}

watch(database.phase, (phase) => {
	if (phase.kind === "choosing") access.value = "read";
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
				v-for="option in CONNECTABLE_ENGINES"
				:key="option"
				role="radio"
				:aria-checked="engine === option"
				:icon="ENGINE_ICONS[option] ?? DEFAULT_ENGINE_ICON"
				:label="ENGINES[option].label"
				size="sm"
				:color="engine === option ? 'primary' : 'neutral'"
				:variant="engine === option ? 'soft' : 'outline'"
				:class="engine === option && 'ring-primary ring-1 ring-inset'"
				:disabled="busy"
				@click="pickEngine(option)"
			/>
		</div>
		<UFormField
			:label="t('dms_ai.views.onboarding.database.url')"
			class="mt-4"
			:error="urlHint ?? false"
		>
			<UInput
				:model-value="url"
				:placeholder="placeholder(engine)"
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
		<fieldset v-if="choosing" class="mt-4" data-access-choice>
			<legend class="text-highlighted mb-2 text-[13px] font-semibold">
				{{ t("dms_ai.views.onboarding.database.access_title") }}
			</legend>
			<div class="grid gap-2 sm:grid-cols-2" role="radiogroup">
				<button
					v-for="option in ACCESS_OPTIONS"
					:key="option.value"
					type="button"
					role="radio"
					:aria-checked="access === option.value"
					:data-access="option.value"
					class="focus-visible:ring-primary flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2"
					:class="
						access === option.value
							? 'border-primary bg-primary/10 ring-primary ring-1 ring-inset'
							: 'border-default hover:bg-elevated/60'
					"
					@click="access = option.value"
				>
					<UIcon
						:name="option.icon"
						class="mt-0.5 size-4 shrink-0"
						:class="access === option.value ? 'text-primary' : 'text-muted'"
					/>
					<span class="min-w-0">
						<span class="text-highlighted block text-[13px] font-semibold">
							{{ t(option.label) }}
						</span>
						<span class="text-muted block text-xs">{{ t(option.hint) }}</span>
					</span>
				</button>
			</div>
		</fieldset>
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
