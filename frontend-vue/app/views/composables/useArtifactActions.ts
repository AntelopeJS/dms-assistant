import { ref, type Ref } from "vue";
import { AI_ROUTES } from "../constants";

export interface ArtifactActions {
	isBusy: Ref<boolean>;
	/** Asks the delete dialog the server words, deletes from inside it, and says whether it happened. */
	remove: (artifactId: string) => Promise<boolean>;
}

const AI_COLOR = "secondary";

/**
 * Deleting an artifact, confirmed by a toast; the page is read again once the
 * sidecar has removed it, and the action stays busy until it is.
 */
export function useArtifactActions(): ArtifactActions {
	const { t } = useI18n();
	const toast = useToast();
	const { $authFetch } = useAuthFetch();
	const { confirmFrom } = useConfirmFrom();
	const isBusy = ref(false);

	async function sendDelete(artifactId: string): Promise<void> {
		await $authFetch(
			`${AI_ROUTES.artifacts}/${encodeURIComponent(artifactId)}`,
			{ method: "DELETE" },
		);
		toast.add({
			title: t("dms_assistant.views.artifacts.deleted"),
			color: AI_COLOR,
			icon: "i-ph-trash",
		});
	}

	async function remove(artifactId: string): Promise<boolean> {
		isBusy.value = true;
		try {
			const isDeleted = await confirmFrom(AI_ROUTES.artifactDeleteConfirm, {
				params: { id: artifactId },
				onConfirm: () => sendDelete(artifactId),
			});
			if (isDeleted) await refreshPageBlocks();
			return isDeleted;
		} finally {
			isBusy.value = false;
		}
	}

	return { isBusy, remove };
}
