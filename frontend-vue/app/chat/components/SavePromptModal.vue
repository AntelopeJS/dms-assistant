<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useChatI18n } from "../composables/useChatI18n";

interface Props {
	/** The draft being saved; the modal is open while there is one. */
	text: string | null;
	/** Why the last save was refused, until the next attempt. */
	error: string | null;
	isSaving: boolean;
}

interface Emits {
	save: [name: string];
	cancel: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useChatI18n();

const name = ref("");

watch(
	() => props.text,
	() => {
		name.value = "";
	},
);

const canSave = computed(() => !props.isSaving && name.value.trim() !== "");

function onOpenChange(isOpen: boolean): void {
	if (!isOpen) emit("cancel");
}

function save(): void {
	if (canSave.value) emit("save", name.value.trim());
}
</script>

<template>
	<UModal
		:open="text !== null"
		:title="t('dms_assistant.panel.prompts.save_title')"
		@update:open="onOpenChange"
	>
		<template #body>
			<form class="cb-save-prompt" @submit.prevent="save">
				<label class="cb-save-prompt__label" for="cb-save-prompt-name">
					{{ t("dms_assistant.panel.prompts.name") }}
				</label>
				<UInput
					id="cb-save-prompt-name"
					v-model="name"
					class="cb-save-prompt__name"
					:placeholder="t('dms_assistant.panel.prompts.name_placeholder')"
					:aria-label="t('dms_assistant.panel.prompts.name')"
					autofocus
				/>
				<p v-if="error" class="cb-save-prompt__error" role="alert">
					{{ error }}
				</p>
				<blockquote class="cb-save-prompt__text">{{ text }}</blockquote>
				<p class="cb-save-prompt__hint">
					{{ t("dms_assistant.panel.prompts.save_hint") }}
				</p>
			</form>
		</template>
		<template #footer>
			<div class="cb-save-prompt__foot">
				<UButton
					color="neutral"
					variant="outline"
					:label="t('dms_assistant.common.cancel')"
					@click="emit('cancel')"
				/>
				<UButton
					color="secondary"
					icon="i-ph-bookmark-simple"
					:disabled="!canSave"
					:loading="isSaving"
					:label="t('dms_assistant.panel.prompts.save')"
					@click="save"
				/>
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.cb-save-prompt {
	display: grid;
	gap: 8px;
}

.cb-save-prompt__label {
	font-size: 12.5px;
	font-weight: 600;
	color: var(--ui-text-highlighted);
}

.cb-save-prompt__name {
	width: 100%;
}

.cb-save-prompt__error {
	margin: 0;
	font-size: 12.5px;
	color: var(--ui-error);
}

.cb-save-prompt__text {
	max-height: 160px;
	margin: 4px 0 0;
	padding: 8px 10px;
	overflow: auto;
	border-left: 3px solid var(--ai-line);
	border-radius: var(--ai-radius-sm);
	background: var(--dms-bg-field);
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--ui-text-toned);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.cb-save-prompt__hint {
	margin: 0;
	font-size: 12px;
	color: var(--ui-text-muted);
}

.cb-save-prompt__foot {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	width: 100%;
}
</style>
