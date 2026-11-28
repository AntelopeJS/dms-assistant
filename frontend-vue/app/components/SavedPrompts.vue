<script setup lang="ts">
import { computed, ref } from "vue";
import SavedPromptEditor from "../views/SavedPromptEditor.vue";
import UnavailableState from "../views/UnavailableState.vue";
import { useAssistant } from "../views/composables/useAssistant";
import {
	type SavedPromptDraft,
	type SaveRefusal,
	useSavedPrompts,
} from "../views/composables/useSavedPrompts";
import { useViewFormat } from "../views/composables/useViewFormat";
import type { SavedPrompt } from "../views/types";

const { t } = useI18n();
const { moment } = useViewFormat();
const assistant = useAssistant();
const prompts = useSavedPrompts();

const SKELETON_ROWS = 3;

const search = ref("");
const editing = ref<SavedPromptDraft | null>(null);
const refusal = ref<SaveRefusal | null>(null);
const deleting = ref<SavedPrompt | null>(null);

function matches(prompt: SavedPrompt, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	return (
		prompt.name.toLowerCase().includes(needle) ||
		prompt.text.toLowerCase().includes(needle)
	);
}

const visible = computed(() =>
	prompts.prompts.value.filter((prompt) => matches(prompt, search.value)),
);
const total = computed(() => prompts.prompts.value.length);

function openNew(): void {
	refusal.value = null;
	editing.value = { name: "", text: "" };
}

function openEdit(prompt: SavedPrompt): void {
	refusal.value = null;
	editing.value = { id: prompt.id, name: prompt.name, text: prompt.text };
}

async function save(draft: SavedPromptDraft): Promise<void> {
	refusal.value = null;
	const outcome = await prompts.save(draft);
	if ("refused" in outcome) {
		refusal.value = outcome.refused;
		return;
	}
	editing.value = null;
}

function run(prompt: SavedPrompt): void {
	assistant.startConversation(prompt.text, { send: true });
}

function onDeleteOpenChange(isOpen: boolean): void {
	if (!isOpen) deleting.value = null;
}

async function confirmDelete(): Promise<void> {
	const prompt = deleting.value;
	if (prompt === null) return;
	const removed = await prompts.remove(prompt);
	if (removed) deleting.value = null;
}

const emptyActions = computed(() => [
	{
		label: t("dms_assistant.views.prompts.new"),
		icon: "i-ph-plus",
		color: "secondary" as const,
		onClick: openNew,
	},
]);
</script>

<template>
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<UInput
				v-model="search"
				icon="i-ph-magnifying-glass"
				size="sm"
				class="w-full sm:w-64"
				:placeholder="t('dms_assistant.views.prompts.search')"
				:aria-label="t('dms_assistant.views.prompts.search')"
			/>
			<UButton
				color="secondary"
				size="sm"
				icon="i-ph-plus"
				:label="t('dms_assistant.views.prompts.new')"
				@click="openNew"
			/>
		</div>

		<DmsCardPanel v-if="prompts.failure.value && total === 0" :padded="false">
			<UnavailableState
				:failure="prompts.failure.value"
				:message="prompts.message.value"
				@retry="prompts.reload"
			/>
		</DmsCardPanel>
		<DmsCardPanel
			v-else-if="prompts.isLoading.value"
			class="flex flex-col gap-4"
			:aria-busy="true"
			:aria-label="t('dms_assistant.views.common.loading')"
		>
			<USkeleton
				v-for="index in SKELETON_ROWS"
				:key="index"
				class="h-14 w-full"
			/>
		</DmsCardPanel>
		<DmsCardPanel v-else-if="total === 0" :padded="false">
			<DmsEmptyState
				icon="i-ph-bookmark-simple"
				:title="t('dms_assistant.views.prompts.empty_title')"
				:description="t('dms_assistant.views.prompts.empty_description')"
				:actions="emptyActions"
			/>
		</DmsCardPanel>
		<DmsCardPanel v-else-if="visible.length === 0" :padded="false">
			<DmsEmptyState
				variant="no-result"
				:title="t('dms_assistant.views.prompts.no_match_title')"
				:description="t('dms_assistant.views.prompts.no_match_description')"
			/>
		</DmsCardPanel>
		<DmsCardPanel v-else :padded="false">
			<ul class="divide-default divide-y">
				<li
					v-for="prompt in visible"
					:key="prompt.id"
					class="flex items-start gap-4 px-5 py-4"
					:data-prompt-id="prompt.id"
				>
					<div class="min-w-0 flex-1">
						<h3 class="text-highlighted text-[14px] font-[650] leading-snug">
							{{ prompt.name }}
						</h3>
						<p
							class="text-muted mt-1 line-clamp-2 whitespace-pre-line text-[13px] leading-normal"
						>
							{{ prompt.text }}
						</p>
						<p class="text-dimmed mt-1.5 font-mono text-[10.5px]">
							{{
								t("dms_assistant.views.prompts.updated", {
									time: moment(prompt.updatedAtMs),
								})
							}}
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-1.5">
						<UButton
							v-if="assistant.isAvailable"
							icon="i-ph-play"
							color="secondary"
							size="sm"
							:label="t('dms_assistant.views.prompts.run')"
							:title="t('dms_assistant.views.prompts.run_hint')"
							@click="run(prompt)"
						/>
						<UButton
							icon="i-ph-pencil-simple"
							color="neutral"
							variant="ghost"
							size="sm"
							square
							:aria-label="t('dms_assistant.views.prompts.edit')"
							:title="t('dms_assistant.views.prompts.edit')"
							@click="openEdit(prompt)"
						/>
						<UButton
							icon="i-ph-trash"
							color="neutral"
							variant="ghost"
							size="sm"
							square
							:aria-label="t('dms_assistant.views.prompts.delete')"
							:title="t('dms_assistant.views.prompts.delete')"
							@click="deleting = prompt"
						/>
					</div>
				</li>
			</ul>
			<footer
				class="border-default text-muted border-t px-5 py-3 text-[12.5px]"
			>
				{{ t("dms_assistant.views.prompts.count", { count: total }, total) }}
			</footer>
		</DmsCardPanel>

		<SavedPromptEditor
			:draft="editing"
			:is-busy="prompts.isBusy.value"
			:refusal="refusal"
			@save="save"
			@cancel="editing = null"
		/>

		<UModal
			:open="deleting !== null"
			:title="
				t('dms_assistant.views.prompts.delete_title', {
					name: deleting?.name ?? '',
				})
			"
			@update:open="onDeleteOpenChange"
		>
			<template #body>
				<p class="text-muted text-[13px] leading-normal">
					{{ t("dms_assistant.views.prompts.delete_text") }}
				</p>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						color="neutral"
						variant="outline"
						:label="t('dms_assistant.views.prompts.cancel')"
						@click="deleting = null"
					/>
					<UButton
						color="error"
						icon="i-ph-trash"
						:loading="prompts.isBusy.value"
						:label="t('dms_assistant.views.prompts.delete_confirm')"
						@click="confirmDelete"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>
