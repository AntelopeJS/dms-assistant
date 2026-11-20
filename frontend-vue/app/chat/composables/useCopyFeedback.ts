import { onBeforeUnmount, ref } from "vue";

const COPIED_FOR_MS = 1_600;

/**
 * Copies text to the clipboard and tracks which source was copied last.
 * `copiedId` returns to `null` after 1.6 s, and a failed write leaves it unchanged.
 */
export function useCopyFeedback() {
	const copiedId = ref<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function copy(text: string, id: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			return;
		}
		copiedId.value = id;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			copiedId.value = null;
			timer = null;
		}, COPIED_FOR_MS);
	}

	onBeforeUnmount(() => {
		if (timer !== null) clearTimeout(timer);
	});

	return { copiedId, copy };
}
