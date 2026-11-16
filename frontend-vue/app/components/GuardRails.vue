<script setup lang="ts">
import { computed } from "vue";
import UnavailableState from "../views/UnavailableState.vue";
import { useGuardRails } from "../views/composables/useGuardRails";
import {
	LOCKED_SWITCH_FIELD,
	MODE_ROWS,
	SWITCH_ROWS,
	modeOf,
	type ModeRow,
	type SwitchRow,
} from "../views/guard-rails";

const { t } = useI18n();
const guard = useGuardRails();

function settingsText(...segments: string[]): string {
	return t(["dms_assistant", "settings", ...segments].join("."));
}

const hint = computed(() => settingsText("hints", "new_conversations"));

const MODE_CARDS_UI = { fieldset: "grid gap-2.5 sm:grid-cols-2" };

function modeItems(row: ModeRow) {
	return row.modes.map((mode) => ({
		value: mode,
		label: settingsText("mode", mode, "label"),
		description: settingsText(
			"mode",
			mode,
			row.provider === "codex" && mode === "acceptEdits"
				? "description_codex"
				: "description",
		),
	}));
}

function pickMode(row: ModeRow, value: unknown): void {
	const mode = modeOf(row, value);
	if (mode) void guard.save(row.field, mode);
}

/** Safe mode needs the Builder: without it the switch stays, off, saying why. */
function isBuilderMissing(row: SwitchRow): boolean {
	return (
		row.field === "safeMode" && guard.values.value?.builderAvailable === false
	);
}

function switchDescription(row: SwitchRow): string {
	return settingsText(
		row.text,
		isBuilderMissing(row) ? "builder_missing" : "description",
	);
}

function switchAriaLabel(row: SwitchRow): string {
	return settingsText(
		row.text,
		row.field === LOCKED_SWITCH_FIELD ? "locked" : "label",
	);
}

function isSwitchDisabled(row: SwitchRow): boolean {
	return (
		row.field === LOCKED_SWITCH_FIELD ||
		isBuilderMissing(row) ||
		guard.isSaving(row.field)
	);
}

function pickSwitch(row: SwitchRow, value: boolean): void {
	if (row.field !== LOCKED_SWITCH_FIELD) void guard.save(row.field, value);
}
</script>

<template>
	<DmsCardPanel
		v-if="!guard.isTurnedOff.value"
		:padded="false"
		:title="t('dms_assistant.views.guard_rails.title')"
	>
		<UnavailableState
			v-if="guard.failure.value && !guard.values.value"
			:failure="guard.failure.value"
			:message="guard.message.value"
			@retry="guard.reload"
		/>
		<div
			v-else-if="!guard.values.value"
			class="flex flex-col gap-4 p-5"
			:aria-busy="true"
			:aria-label="t('dms_assistant.views.common.loading')"
		>
			<USkeleton v-for="index in 4" :key="index" class="h-10 w-full" />
		</div>
		<div v-else class="flex flex-col">
			<p class="text-muted px-5 pt-4 text-[12.5px]/normal">
				{{ t("dms_assistant.views.guard_rails.description") }}
			</p>
			<DmsFieldRow
				v-for="row in MODE_ROWS"
				:key="row.field"
				layout="stack"
				:label="settingsText(row.text, 'label')"
				:description="settingsText(row.text, 'description')"
			>
				<div class="flex flex-col gap-2">
					<URadioGroup
						:model-value="guard.values.value[row.field]"
						:items="modeItems(row)"
						:disabled="guard.isSaving(row.field)"
						:aria-label="settingsText(row.text, 'label')"
						variant="card"
						:ui="MODE_CARDS_UI"
						@update:model-value="pickMode(row, $event)"
					/>
					<p class="text-dimmed text-[12px]/normal">{{ hint }}</p>
				</div>
			</DmsFieldRow>
			<template v-for="row in SWITCH_ROWS" :key="row.field">
				<div v-if="row.startsAlwaysAsk" class="px-5 pt-4">
					<b class="text-highlighted block text-[13px] font-semibold">
						{{ settingsText("always_ask", "label") }}
					</b>
					<span class="text-muted block text-[12.5px]/normal">
						{{ settingsText("always_ask", "description") }}
					</span>
				</div>
				<DmsFieldRow
					:label="settingsText(row.text, row.title)"
					:description="switchDescription(row)"
				>
					<USwitch
						:model-value="guard.values.value[row.field]"
						:disabled="isSwitchDisabled(row)"
						:aria-label="switchAriaLabel(row)"
						@update:model-value="pickSwitch(row, $event)"
					/>
					<template v-if="row.hasHint" #details>
						<span class="text-dimmed text-[12px]/normal">{{ hint }}</span>
					</template>
				</DmsFieldRow>
			</template>
		</div>
	</DmsCardPanel>
</template>
