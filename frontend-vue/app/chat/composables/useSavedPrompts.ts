import { ref, type Ref } from "vue";
import { z } from "zod";
import type { SavedPrompt } from "../types/saved-prompt";
import type { ChatApi } from "./useChangeSetActions";
import type { Translate } from "./useChatI18n";

export interface UseSavedPromptsOptions {
	api: ChatApi | null;
	t: Translate;
}

/** The prompt once the backend saved it, or its reason not to, in the user's language. */
export type SaveResult = { saved: SavedPrompt } | { error: string };

export interface UseSavedPromptsResult {
	/** The member's saved prompts, by name; empty until a read answers. */
	prompts: Ref<SavedPrompt[]>;
	isSaving: Ref<boolean>;
	/** Reads the list again; a failed read keeps the list as it was. */
	refresh: () => Promise<void>;
	/** Saves `text` under `name` for the member. */
	save: (name: string, text: string) => Promise<SaveResult>;
}

const PROMPTS_PATH = "/ai/prompts";
const SAVE_FAILED_KEY = "dms_assistant.panel.prompts.save_failed";
const I18N_KEY_SIGIL = "$";

const SAVED_PROMPT_SCHEMA: z.ZodType<SavedPrompt> = z.looseObject({
	id: z.string(),
	ownerId: z.string(),
	name: z.string(),
	text: z.string(),
	createdAtMs: z.number(),
	updatedAtMs: z.number(),
});

const PAGE_SCHEMA = z.looseObject({ results: z.array(SAVED_PROMPT_SCHEMA) });

/** A refusal of the module, as the dashboard's fetch rejects with it: a translated key and its parameters. */
const REFUSAL_SCHEMA = z.object({
	data: z.object({
		message: z.string(),
		params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
	}),
});

function byName(left: SavedPrompt, right: SavedPrompt): number {
	return left.name.localeCompare(right.name, undefined, {
		sensitivity: "base",
	});
}

/** The refusal's message in the user's language, else the panel's own words. */
function reasonOf(error: unknown, t: Translate): string {
	const refusal = REFUSAL_SCHEMA.safeParse(error);
	if (!refusal.success) return t(SAVE_FAILED_KEY);
	const { message, params } = refusal.data.data;
	const key = message.startsWith(I18N_KEY_SIGIL)
		? message.slice(I18N_KEY_SIGIL.length)
		: message;
	return t(key, params);
}

/**
 * The chat's client of the member's saved prompts: the list the empty chat
 * offers, and the save behind "Save as prompt". Both go through the
 * dashboard's authenticated requests; without them (no session yet) the list
 * stays empty and a save says so.
 */
export function useSavedPrompts(
	options: UseSavedPromptsOptions,
): UseSavedPromptsResult {
	const prompts = ref<SavedPrompt[]>([]);
	const isSaving = ref(false);

	async function refresh(): Promise<void> {
		if (options.api === null) return;
		try {
			const page = PAGE_SCHEMA.safeParse(
				await options.api.get<unknown>(PROMPTS_PATH),
			);
			if (page.success) prompts.value = [...page.data.results].sort(byName);
		} catch {
			return;
		}
	}

	async function save(name: string, text: string): Promise<SaveResult> {
		if (options.api === null) return { error: options.t(SAVE_FAILED_KEY) };
		isSaving.value = true;
		try {
			const saved = SAVED_PROMPT_SCHEMA.parse(
				await options.api.post<unknown>(PROMPTS_PATH, { name, text }),
			);
			prompts.value = [...prompts.value, saved].sort(byName);
			return { saved };
		} catch (error) {
			return { error: reasonOf(error, options.t) };
		} finally {
			isSaving.value = false;
		}
	}

	return { prompts, isSaving, refresh, save };
}
