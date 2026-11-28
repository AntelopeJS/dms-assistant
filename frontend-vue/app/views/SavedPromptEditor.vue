<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
	SavedPromptDraft,
	SavedPromptField,
	SaveRefusal,
} from "./composables/useSavedPrompts";

interface Props {
	/** The prompt being written; the editor is open while there is one. */
	draft: SavedPromptDraft | null;
	isBusy: boolean;
	/** Why the last save was refused, until the next attempt. */
	refusal: SaveRefusal | null;
}

interface Emits {
	save: [draft: SavedPromptDraft];
	cancel: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useI18n();

const TEXT_ROWS = 8;

const name = ref("");
const text = ref("");

watch(
	() => props.draft,
	(draft) => {
		name.value = draft?.name ?? "";
		text.value = draft?.text ?? "";
	},
	{ immediate: true },
);

const title = computed(() =>
	props.draft?.id === undefined
		? t("dms_assistant.views.prompts.new_title")
		: t("dms_assistant.views.prompts.edit_title"),
);
const canSave = computed(
	() => !props.isBusy && name.value.trim() !== "" && text.value.trim() !== "",
);

function refusalOf(field: SavedPromptField): string | null {
	const refusal = props.refusal;
	if (refusal === null) return null;
	return (refusal.field ?? "name") === field ? refusal.message : null;
}

const nameRefusal = computed(() => refusalOf("name"));
const textRefusal = computed(() => refusalOf("text"));

function onOpenChange(isOpen: boolean): void {
	if (!isOpen) emit("cancel");
}

function save(): void {
	if (!canSave.value || props.draft === null) return;
	emit("save", { ...props.draft, name: name.value, text: text.value });
}
</script>

<template>
	<UModal :open="draft !== null" :title="title" @update:open="onOpenChange">
		<template #body>
			<form class="flex flex-col gap-4" @submit.prevent="save">
				<UFormField
					:label="t('dms_assistant.views.prompts.name')"
					:error="nameRefusal ?? undefined"
				>
					<UInput
						v-model="name"
						class="w-full"
						:placeholder="t('dms_assistant.views.prompts.name_placeholder')"
						:aria-label="t('dms_assistant.views.prompts.name')"
						autofocus
					/>
					<p
						v-if="nameRefusal"
						class="text-error mt-1 text-[12.5px]"
						role="alert"
					>
						{{ nameRefusal }}
					</p>
				</UFormField>
				<UFormField
					:label="t('dms_assistant.views.prompts.text')"
					:error="textRefusal ?? undefined"
				>
					<UTextarea
						v-model="text"
						class="w-full"
						:rows="TEXT_ROWS"
						:placeholder="t('dms_assistant.views.prompts.text_placeholder')"
						:aria-label="t('dms_assistant.views.prompts.text')"
					/>
					<p
						v-if="textRefusal"
						class="text-error mt-1 text-[12.5px]"
						role="alert"
					>
						{{ textRefusal }}
					</p>
				</UFormField>
			</form>
		</template>
		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton
					color="neutral"
					variant="outline"
					:label="t('dms_assistant.views.prompts.cancel')"
					@click="emit('cancel')"
				/>
				<UButton
					color="secondary"
					icon="i-ph-bookmark-simple"
					:disabled="!canSave"
					:loading="isBusy"
					:label="t('dms_assistant.views.prompts.save')"
					@click="save"
				/>
			</div>
		</template>
	</UModal>
</template>
