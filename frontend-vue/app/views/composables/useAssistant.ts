import { getCurrentInstance, inject, onMounted, ref } from "vue";
import { useDmsRouter, type DmsRouter } from "#dms/frontend-module";
import { ASSISTANT_SESSION_KEY } from "../../runtime/assistant-session";

/** What the actions need of the dashboard's router. */
type AssistantRouter = Pick<DmsRouter, "push">;

/** How a view starts a conversation: with the prompt sent at once, or left in the composer. */
export interface StartConversationOptions {
	send?: boolean;
}

export interface AssistantActions {
	/** The assistant runs in this tab: its buttons can be offered. Reactive. */
	readonly isAvailable: boolean;
	openPanel: () => void;
	openConversation: (conversationId: string) => void;
	/** Opens the panel on a new conversation, `prompt` in the composer, or sent when `send` is set. */
	startConversation: (
		prompt?: string,
		options?: StartConversationOptions,
	) => void;
	/** Opens a dashboard page, as its own links do. */
	goTo: (path: string) => void;
}

/**
 * The tab's assistant session as the workspace views use it. Until it runs
 * (its first probe pending) and without one (production, sidecar disabled) the
 * actions do nothing and `isAvailable` hides the buttons that need them.
 *
 * A view only offers them once mounted: the server never has a session, and a
 * probe that answered before the view hydrated would otherwise make the
 * browser render buttons the server's HTML lacks.
 *
 * `router` opens the pages `goTo` names; the dashboard's own is the default.
 */
export function useAssistant(
	router: AssistantRouter = useDmsRouter(),
): AssistantActions {
	const session = inject(ASSISTANT_SESSION_KEY, null);
	const isMounted = ref(!getCurrentInstance());
	if (!isMounted.value) onMounted(() => (isMounted.value = true));
	return {
		get isAvailable() {
			return isMounted.value && (session?.value ?? null) !== null;
		},
		openPanel: () => session?.value?.panel.open(),
		openConversation: (conversationId) =>
			session?.value?.openConversation(conversationId),
		startConversation: (prompt, options) =>
			session?.value?.startConversation(prompt, undefined, options?.send),
		goTo: (path) => void router.push(path),
	};
}
