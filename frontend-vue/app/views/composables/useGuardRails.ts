import { computed, ref, watch, type ComputedRef } from "vue";
import { OWNER_UI_HEADERS } from "../../../builder/app/runtime/owner-ui";
import { JSON_CONTENT_TYPE } from "../../runtime/constants";
import { AI_ROUTES } from "../constants";
import type { GuardRailField, GuardRailValues } from "../guard-rails";
import type { AssistantStatus } from "../types";
import { classifyFailure, useAiData, type RequestFailure } from "./useAiData";

export interface GuardRails {
	/**
	 * The values shown: the confirmed ones, with the value of each save in
	 * flight over its field; none until the first read answers.
	 */
	values: ComputedRef<GuardRailValues | null>;
	/** The module's configuration turns the sidecar off: the page's offline banner says so alone. */
	isTurnedOff: ComputedRef<boolean>;
	failure: ComputedRef<RequestFailure | null>;
	message: ComputedRef<string>;
	reload: () => Promise<void>;
	isSaving: (field: GuardRailField) => boolean;
	/**
	 * Saves one field on its own, with the assistant UI's header: the value
	 * shows at once, becomes the confirmed one when the save is accepted, and
	 * gives way to the confirmed one when the save is refused or fails.
	 */
	save: <Field extends GuardRailField>(
		field: Field,
		value: GuardRailValues[Field],
	) => Promise<void>;
}

/**
 * The assistant's own client of the guard-rail settings. It is the one place
 * that writes them: `PUT /ai/settings` takes a guard rail only with the
 * assistant UI's header, which a DMS form's save cannot send.
 */
export function useGuardRails(): GuardRails {
	const { $authFetch } = useAuthFetch();
	const presenter = useApiErrorPresenter();
	const read = useAiData<GuardRailValues>(AI_ROUTES.settings);
	const status = useAiData<AssistantStatus>(AI_ROUTES.status);
	const confirmed = ref<GuardRailValues | null>(null);
	const pending = ref<Partial<GuardRailValues>>({});

	watch(
		() => read.data.value,
		(settings) => {
			if (settings) confirmed.value = { ...settings };
		},
		{ immediate: true },
	);

	const values = computed(() =>
		confirmed.value ? { ...confirmed.value, ...pending.value } : null,
	);

	function isSaving(field: GuardRailField): boolean {
		return Object.hasOwn(pending.value, field);
	}

	function settle(field: GuardRailField): void {
		pending.value = Object.fromEntries(
			Object.entries(pending.value).filter(([name]) => name !== field),
		);
	}

	async function save<Field extends GuardRailField>(
		field: Field,
		value: GuardRailValues[Field],
	): Promise<void> {
		if (!confirmed.value || isSaving(field)) return;
		pending.value = { ...pending.value, [field]: value };
		try {
			await $authFetch(AI_ROUTES.settings, {
				method: "PUT",
				body: JSON.stringify({ [field]: value }),
				headers: { "content-type": JSON_CONTENT_TYPE, ...OWNER_UI_HEADERS },
			});
			if (confirmed.value) {
				confirmed.value = {
					...confirmed.value,
					[field]: value,
				};
			}
		} catch (error) {
			presenter.presentError(error, {
				fallbackKey:
					classifyFailure(error) === "unavailable"
						? "dms_assistant.views.unavailable.description"
						: "dms_assistant.views.guard_rails.not_saved",
			});
		} finally {
			settle(field);
		}
	}

	return {
		values,
		isTurnedOff: computed(() => status.data.value?.disabled === true),
		failure: computed(() => read.failure.value),
		message: computed(() => read.message.value),
		reload: () => read.refresh(),
		isSaving,
		save,
	};
}
