<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useBuilderApi } from "../../../builder/app/runtime/api";
import {
	type ConnectionAccess,
	type DatabaseEngine,
	ENGINES,
	engineOfScheme,
	unavailableReason,
} from "../../../builder/app/runtime/database-connect";
import type { ProjectModules } from "../../../builder/app/runtime/database-types";
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
		label: "dms_assistant.views.onboarding.database.access_read",
		hint: "dms_assistant.views.onboarding.database.access_read_hint",
	},
	{
		value: "read-write",
		icon: "i-ph-pencil-simple",
		label: "dms_assistant.views.onboarding.database.access_write",
		hint: "dms_assistant.views.onboarding.database.access_write_hint",
	},
];

const onboarding = useOnboarding();
const { t } = useChatI18n();
const api = useBuilderApi();
const engine = ref<DatabaseEngine>(
	onboarding.connecting.read()?.engine ?? "postgres",
);
const database = useDatabaseConnect(api, onboarding.connecting);
const project = ref<ProjectModules | null>(null);

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
const unavailable = computed(() => {
	const drivers = project.value?.drivers;
	return drivers === undefined
		? []
		: CONNECTABLE_ENGINES.filter((option) => drivers[option] === undefined);
});
const canConnect = computed(
	() =>
		url.value.trim() !== "" &&
		!busy.value &&
		!unavailable.value.includes(engine.value),
);

function checkText(check: ConnectCheck): string {
	switch (check.key) {
		case "reachable":
			if (check.status === "running") {
				return t("dms_assistant.views.onboarding.database.reachable_running");
			}
			if (check.status === "failed" && check.install !== undefined) {
				return check.error ?? "";
			}
			if (check.status === "failed") {
				return t("dms_assistant.views.onboarding.database.unreachable", {
					error: check.error ?? "",
				});
			}
			return check.latencyMs === undefined
				? t("dms_assistant.views.onboarding.database.reachable")
				: t("dms_assistant.views.onboarding.database.reachable_latency", {
						ms: check.latencyMs,
					});
		case "signed-in":
			if (check.status === "failed") {
				return t("dms_assistant.views.onboarding.database.signed_in_failed", {
					error: check.error ?? "",
				});
			}
			if (check.status !== "done") {
				return t("dms_assistant.views.onboarding.database.signed_in_pending");
			}
			return check.user === undefined
				? t("dms_assistant.views.onboarding.database.signed_in_no_user")
				: t("dms_assistant.views.onboarding.database.signed_in", {
						user: check.user,
					});
		case "read":
			if (check.status === "failed") {
				return t("dms_assistant.views.onboarding.database.read_failed", {
					error: check.error ?? "",
				});
			}
			return check.canWrite
				? t("dms_assistant.views.onboarding.database.read_write")
				: t("dms_assistant.views.onboarding.database.read");
		case "schema":
			if (check.problem === "empty") {
				return t("dms_assistant.views.onboarding.database.empty");
			}
			if (check.problem === "gave-up") {
				return t("dms_assistant.views.onboarding.database.gave_up");
			}
			if (check.restart) {
				return t("dms_assistant.views.onboarding.database.restart");
			}
			if (check.problem === "failed") {
				return t("dms_assistant.views.onboarding.database.schema_failed", {
					error: check.error ?? "",
				});
			}
			return check.status === "done"
				? t("dms_assistant.views.onboarding.database.schema_done")
				: t("dms_assistant.views.onboarding.database.schema_running");
	}
}

const copiedInstall = ref(false);

async function copyInstall(command: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(command);
	} catch {
		return;
	}
	copiedInstall.value = true;
}

const urlHint = computed(() => {
	const problem = urlProblem.value;
	if (problem === null) return null;
	if (problem.kind === "invalid") return problem.message;
	if (problem.kind === "no-database") {
		return t("dms_assistant.views.onboarding.database.no_database");
	}
	if (problem.kind === "no-name") {
		return t("dms_assistant.views.onboarding.database.no_name");
	}
	return t("dms_assistant.views.onboarding.database.unreadable", {
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
	copiedInstall.value = false;
	urlProblem.value = await database.connect(engine.value, url.value);
}

onMounted(async () => {
	project.value = await api.projectModules().catch(() => null);
});

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
		:title="t('dms_assistant.views.onboarding.database.title')"
		:lede="t('dms_assistant.views.onboarding.database.lede')"
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
				:disabled="busy || unavailable.includes(option)"
				@click="pickEngine(option)"
			/>
		</div>
		<p
			v-for="option in unavailable"
			:key="option"
			class="text-dimmed mt-2 flex items-center gap-1.5 text-xs"
			:data-unavailable="option"
		>
			<UIcon name="i-ph-prohibit" class="size-3.5 shrink-0" />
			{{ unavailableReason(option, project?.interfaceDatabase) }}
		</p>
		<UFormField
			:label="t('dms_assistant.views.onboarding.database.url')"
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
				@keydown.enter="canConnect && connect()"
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
				<span class="min-w-0">
					{{ checkText(check) }}
					<span
						v-if="check.key === 'reachable' && check.install !== undefined"
						class="text-default mt-1.5 block"
						data-driver-install
					>
						<span class="flex items-center gap-1.5">
							<code
								class="bg-elevated select-all rounded px-1.5 py-0.5 font-mono text-xs"
							>
								{{ check.install }}
							</code>
							<UButton
								size="xs"
								color="neutral"
								variant="ghost"
								:icon="copiedInstall ? 'i-ph-check' : 'i-ph-copy'"
								:aria-label="
									t('dms_assistant.views.onboarding.database.install_copy')
								"
								@click="copyInstall(check.install)"
							/>
						</span>
						<span class="text-muted mt-1 block text-xs">
							{{ t("dms_assistant.views.onboarding.database.install_retry") }}
						</span>
					</span>
				</span>
			</li>
		</ul>
		<fieldset v-if="choosing" class="mt-4" data-access-choice>
			<legend class="text-highlighted mb-2 text-[13px] font-semibold">
				{{ t("dms_assistant.views.onboarding.database.access_title") }}
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
			{{ t("dms_assistant.views.onboarding.database.stored") }}
		</p>
		<template #footer>
			<UButton
				:label="t('dms_assistant.views.onboarding.back')"
				icon="i-ph-arrow-left"
				color="neutral"
				variant="ghost"
				@click="onboarding.send({ type: 'back' })"
			/>
			<span class="flex-1" />
			<UButton
				:label="t('dms_assistant.views.onboarding.database.connect')"
				trailing-icon="i-ph-arrow-right"
				:disabled="!canConnect"
				:loading="busy"
				@click="connect"
			/>
		</template>
	</OnboardingFrame>
</template>
