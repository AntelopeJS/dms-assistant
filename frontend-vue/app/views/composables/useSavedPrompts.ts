import { computed, type ComputedRef, ref, type Ref } from "vue";
import { z } from "zod";
import { JSON_CONTENT_TYPE } from "../../runtime/constants";
import { AI_ROUTES } from "../constants";
import type { ListPayload, SavedPrompt } from "../types";
import { classifyFailure, useAiData, type RequestFailure } from "./useAiData";

export type SavedPromptField = "name" | "text";

/** What the editor saves: a new prompt, or the edit of the one `id` names. */
export interface SavedPromptDraft {
	id?: string;
	name: string;
	text: string;
}

/** Why a save was refused, placed under the field the backend named when it named one. */
export interface SaveRefusal {
	field?: SavedPromptField;
	message: string;
}

export type SaveOutcome = { saved: SavedPrompt } | { refused: SaveRefusal };

export interface SavedPromptsActions {
	/** The member's prompts, by name; empty until the first read answers. */
	prompts: ComputedRef<SavedPrompt[]>;
	/** The first read is still out. */
	isLoading: ComputedRef<boolean>;
	failure: ComputedRef<RequestFailure | null>;
	message: ComputedRef<string>;
	reload: () => Promise<void>;
	/** A save or a deletion is in flight. */
	isBusy: Ref<boolean>;
	/** Saves the draft, then reads the list again; a refusal is handed back for the editor. */
	save: (draft: SavedPromptDraft) => Promise<SaveOutcome>;
	/** Deletes the prompt, then reads the list again; a failure shows as a toast. */
	remove: (prompt: SavedPrompt) => Promise<boolean>;
}

const NOT_SAVED_KEY = "dms_assistant.views.prompts.not_saved";
const NOT_DELETED_KEY = "dms_assistant.views.prompts.not_deleted";
const UNAVAILABLE_KEY = "dms_assistant.views.unavailable.description";

/** The field a refusal of the module names, when it names one. */
const FieldRefusalSchema = z.object({
	data: z.object({ field: z.enum(["name", "text"]).optional() }),
});

function refusedField(error: unknown): SavedPromptField | undefined {
	const parsed = FieldRefusalSchema.safeParse(error);
	return parsed.success ? parsed.data.data.field : undefined;
}

function promptUrl(id?: string): string {
	return id === undefined
		? AI_ROUTES.prompts
		: `${AI_ROUTES.prompts}/${encodeURIComponent(id)}`;
}

/**
 * The Prompts page's client of `/ai/prompts`: the member's saved prompts,
 * read with the page, and the writes the editor and the list make, each
 * followed by a fresh read so the list shows what the backend holds.
 */
export function useSavedPrompts(): SavedPromptsActions {
	const { $authFetch } = useAuthFetch();
	const presenter = useApiErrorPresenter();
	const read = useAiData<ListPayload<SavedPrompt>>(AI_ROUTES.prompts);
	const isBusy = ref(false);

	async function save(draft: SavedPromptDraft): Promise<SaveOutcome> {
		isBusy.value = true;
		try {
			const saved = await $authFetch<SavedPrompt>(promptUrl(draft.id), {
				method: draft.id === undefined ? "POST" : "PUT",
				body: JSON.stringify({ name: draft.name, text: draft.text }),
				headers: { "content-type": JSON_CONTENT_TYPE },
			});
			await read.refresh();
			return { saved };
		} catch (error) {
			const notice = presenter.resolveError(error, {
				fallbackKey:
					classifyFailure(error) === "unavailable"
						? UNAVAILABLE_KEY
						: NOT_SAVED_KEY,
			});
			return {
				refused: {
					field: refusedField(error),
					message: notice?.message ?? "",
				},
			};
		} finally {
			isBusy.value = false;
		}
	}

	async function remove(prompt: SavedPrompt): Promise<boolean> {
		isBusy.value = true;
		try {
			await $authFetch(promptUrl(prompt.id), { method: "DELETE" });
			await read.refresh();
			return true;
		} catch (error) {
			presenter.presentError(error, {
				fallbackKey:
					classifyFailure(error) === "unavailable"
						? UNAVAILABLE_KEY
						: NOT_DELETED_KEY,
			});
			return false;
		} finally {
			isBusy.value = false;
		}
	}

	return {
		prompts: computed(() => read.data.value?.results ?? []),
		isLoading: computed(
			() => read.data.value === null && read.failure.value === null,
		),
		failure: computed(() => read.failure.value),
		message: computed(() => read.message.value),
		reload: () => read.refresh(),
		isBusy,
		save,
		remove,
	};
}
