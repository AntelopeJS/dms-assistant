import { nextTick, type Ref, ref, watch } from "vue";
import type { MockupBlock } from "../../runtime/assistant-prompt";
import type { MockupPromptIntent } from "../../runtime/panel-intents";

export interface MockupIntentsDeps {
	activeId: Readonly<Ref<string>>;
	isRunning: Readonly<Ref<boolean>>;
	newConversation: () => void;
	setDraft: (text: string) => void;
}

/**
 * A prompt the mockup editor hands the chat about one of its blocks: put in
 * the composer with the block as context, which goes with the next message
 * sent in this conversation.
 */
export function useMockupIntents(deps: MockupIntentsDeps) {
	const focusBlock = ref<MockupBlock | null>(null);

	watch(
		deps.activeId,
		() => {
			focusBlock.value = null;
		},
		{ flush: "sync" },
	);

	function takePrompt(intent: MockupPromptIntent): void {
		if (deps.isRunning.value) deps.newConversation();
		focusBlock.value = intent.block ?? null;
		void nextTick(() => deps.setDraft(intent.prompt));
	}

	function takeFocusBlock(): { focusBlock?: MockupBlock } {
		const block = focusBlock.value;
		focusBlock.value = null;
		return block === null ? {} : { focusBlock: block };
	}

	return { focusBlock, takePrompt, takeFocusBlock };
}
