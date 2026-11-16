import { type Ref, ref } from "vue";
import type { MockupAssistantPrompt, MockupBlock } from "./assistant-prompt";
import type { ConversationStartMode } from "./assistant-session";

/** Opens the panel on a stored conversation. */
interface OpenConversationIntent {
	kind: "open";
	conversationId: string;
}

/**
 * Opens the panel on a new conversation, in `mode` when given. The prompt is put in the composer,
 * or sent as the first message when `send` is set.
 */
export interface StartConversationIntent {
	kind: "start";
	prompt?: string;
	mode?: ConversationStartMode;
	send?: boolean;
}

/** Puts the caret in the composer of the current conversation. */
interface FocusComposerIntent {
	kind: "focus";
}

/** Brings the approvals dock forward. */
interface ReviewApprovalsIntent {
	kind: "approvals";
}

/**
 * A prompt the mockup editor handed over: put in the composer with the block
 * it is about as context, never sent by itself.
 */
export interface MockupPromptIntent {
	kind: "prompt";
	prompt: string;
	block?: MockupBlock;
}

/**
 * Builds a mockup into real pages through a turn, followed in the build
 * dialog; into the existing page `pageRef` when given, rather than a new one.
 */
export interface BuildMockupIntent {
	kind: "build";
	mockup: string;
	pageRef?: string;
}

/**
 * Applies and resolves the open comments of a mockup through a turn in a new
 * conversation, sent without waiting for the user; those of the page `page`
 * only when given.
 */
export interface ResolveCommentsIntent {
	kind: "resolve-comments";
	mockup: string;
	page?: string;
}

export type PanelIntent =
	| OpenConversationIntent
	| StartConversationIntent
	| FocusComposerIntent
	| ReviewApprovalsIntent
	| MockupPromptIntent
	| BuildMockupIntent
	| ResolveCommentsIntent;

/**
 * What the dashboard asked the panel to do: open a chat, start one, focus the
 * composer. The chat may not be mounted yet when it is asked, so the latest
 * request waits here until the chat takes it.
 */
export interface PanelIntents {
	pending: Readonly<Ref<PanelIntent | null>>;
	push: (intent: PanelIntent) => void;
	take: () => PanelIntent | null;
}

export function createPanelIntents(): PanelIntents {
	const pending = ref<PanelIntent | null>(null);
	return {
		pending,
		push: (intent) => {
			pending.value = intent;
		},
		take: () => {
			const intent = pending.value;
			pending.value = null;
			return intent;
		},
	};
}

/** What the panel does for a prompt the mockup editor handed over. */
export function intentOfPrompt(prompt: MockupAssistantPrompt): PanelIntent {
	switch (prompt.source) {
		case "build":
			return {
				kind: "build",
				mockup: prompt.prompt,
				...(prompt.target === undefined
					? {}
					: { pageRef: prompt.target.pageRef }),
			};
		case "resolve-comments":
			return {
				kind: "resolve-comments",
				mockup: prompt.prompt,
				...(prompt.page === undefined ? {} : { page: prompt.page }),
			};
		default:
			return { kind: "prompt", prompt: prompt.prompt, block: prompt.block };
	}
}
