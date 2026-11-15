import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { OWNER_UI_HEADERS } from "../../../builder/app/runtime/owner-ui";
import { JSON_CONTENT_TYPE } from "../../runtime/constants";
import { AI_ROUTES } from "../constants";
import type { GuardRailField, GuardRailValues } from "../guard-rails";
import { classifyFailure, useAiData, type RequestFailure } from "./useAiData";

export interface GuardRails {
	/** The confirmed values; none until the first read answers. */
	values: Readonly<Ref<GuardRailValues | null>>;
	failure: ComputedRef<RequestFailure | null>;
	message: ComputedRef<string>;
	reload: () => Promise<void>;
	isSaving: (field: GuardRailField) => boolean;
	/**
	 * Saves one field on its own, with the assistant UI's header: the value
	 * shows at once, and goes back to the confirmed one when the save is
	 * refused or fails.
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
	const { presentError } = useApiErrorPresenter();
	const read = useAiData<GuardRailValues>(AI_ROUTES.settings);
	const values = ref<GuardRailValues | null>(null);
	const saving = ref<readonly GuardRailField[]>([]);

	watch(
		() => read.data.value,
		(settings) => {
			if (settings) values.value = { ...settings };
		},
		{ immediate: true },
	);

	function isSaving(field: GuardRailField): boolean {
		return saving.value.includes(field);
	}

	async function save<Field extends GuardRailField>(
		field: Field,
		value: GuardRailValues[Field],
	): Promise<void> {
		const current = values.value;
		if (!current || isSaving(field)) return;
		const confirmed = current[field];
		values.value = { ...current, [field]: value };
		saving.value = [...saving.value, field];
		try {
			await $authFetch(AI_ROUTES.settings, {
				method: "PUT",
				body: JSON.stringify({ [field]: value }),
				headers: { "content-type": JSON_CONTENT_TYPE, ...OWNER_UI_HEADERS },
			});
		} catch (error) {
			if (values.value) values.value = { ...values.value, [field]: confirmed };
			presentError(error, {
				fallbackKey:
					classifyFailure(error) === "unavailable"
						? "dms_assistant.views.unavailable.description"
						: "dms_assistant.views.guard_rails.not_saved",
			});
		} finally {
			saving.value = saving.value.filter((name) => name !== field);
		}
	}

	return {
		values,
		failure: computed(() => read.failure.value),
		message: computed(() => read.message.value),
		reload: () => read.refresh(),
		isSaving,
		save,
	};
}
