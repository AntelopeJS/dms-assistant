import { computed, nextTick, type Ref, ref } from "vue";
import type { MockupBlock } from "../../runtime/assistant-prompt";
import type {
	BuildMockupIntent,
	MockupPromptIntent,
} from "../../runtime/panel-intents";
import type { ConversationMessage } from "../types/conversation";
import { type BuildView, buildView } from "../utils/build-view";

export interface MockupIntentsDeps {
	activeId: Readonly<Ref<string>>;
	messages: Readonly<Ref<ConversationMessage[]>>;
	isRunning: Readonly<Ref<boolean>>;
	newConversation: () => void;
	setDraft: (text: string) => void;
	whenConnected: (run: () => void) => void;
	/** Sends the message that asks the agent to build `mockup`. */
	requestBuild: (mockup: string) => void;
	navigate: (path: string) => void;
}

interface Building {
	mockup: string;
	conversationId: string;
}

/**
 * What the mockup editor hands the chat: a prompt about one of its blocks,
 * put in the composer with the block as context, or a mockup to build,
 * followed in the build dialog while its chat is the one on screen.
 */
export function useMockupIntents(deps: MockupIntentsDeps) {
	const focusBlock = ref<MockupBlock | null>(null);
	const building = ref<Building | null>(null);

	const build = computed<BuildView | null>(() => {
		const current = building.value;
		if (current === null || current.conversationId !== deps.activeId.value)
			return null;
		return buildView(current.mockup, deps.messages.value, deps.isRunning.value);
	});

	function takePrompt(intent: MockupPromptIntent): void {
		if (deps.isRunning.value) deps.newConversation();
		focusBlock.value = intent.block ?? null;
		void nextTick(() => deps.setDraft(intent.prompt));
	}

	function startBuild(intent: BuildMockupIntent): void {
		deps.newConversation();
		building.value = {
			mockup: intent.mockup,
			conversationId: deps.activeId.value,
		};
		deps.whenConnected(() => deps.requestBuild(intent.mockup));
	}

	/** The block of the message being sent, as its extra fields; the chip goes with it. */
	function takeFocusBlock(): { focusBlock?: MockupBlock } {
		const block = focusBlock.value;
		focusBlock.value = null;
		return block === null ? {} : { focusBlock: block };
	}

	return {
		focusBlock,
		build,
		takePrompt,
		startBuild,
		takeFocusBlock,
		closeBuild: (): void => {
			building.value = null;
		},
		openBuiltPages: (path: string): void => {
			building.value = null;
			deps.navigate(path);
		},
	};
}
