import { readonly, type Ref } from "vue";
import { OWNER_UI_HEADERS } from "../../builder/app/runtime/owner-ui";
import type { ChatApi } from "../chat/composables/useChangeSetActions";
import type { CurrentPage } from "../chat/types/conversation";
import type { AssistantActivity } from "./assistant-activity";
import type { AssistantSession, ChatPanelState } from "./assistant-session";
import type { ChatTransportHub } from "./chat-transport";
import { JSON_CONTENT_TYPE } from "./constants";
import type { LauncherStateHandle } from "./launcher-state";
import type { Navigator } from "./host-commands";
import type { MockupRuns } from "./mockup-runs";
import { createPanelIntents } from "./panel-intents";
import type { SidecarStatus, SidecarStatusController } from "./sidecar-status";
import type { StreamHolds } from "./stream-holds";

/** The options of a POST that sends `body`, already JSON, as the dashboard's requests carry it. */
export function jsonPost(body: string) {
	return {
		method: "POST" as const,
		body,
		headers: { "content-type": JSON_CONTENT_TYPE, ...OWNER_UI_HEADERS },
	};
}

export interface SessionParts {
	api: ChatApi;
	/** Asks the backend to restart the sidecar. */
	restartBackend: () => Promise<void>;
	controller: SidecarStatusController;
	chat: ChatTransportHub;
	panel: ChatPanelState;
	holds: StreamHolds;
	status: Readonly<Ref<SidecarStatus>>;
	activity: AssistantActivity;
	launcher: LauncherStateHandle;
	currentPage: Ref<CurrentPage | null>;
	navigate: Navigator;
	runs: MockupRuns;
}

export function createSession(parts: SessionParts): AssistantSession {
	const { panel, activity } = parts;
	const intents = createPanelIntents();
	return {
		status: parts.status,
		chat: parts.chat.transport,
		panel,
		navigate: parts.navigate,
		openConversation: (conversationId) => {
			intents.push({ kind: "open", conversationId });
			panel.open();
		},
		startConversation: (prompt, mode, send) => {
			intents.push({ kind: "start", prompt, mode, send });
			panel.open();
		},
		holdStream: parts.holds.hold,
		pendingApprovals: activity.pendingApprovals,
		launcherState: parts.launcher.state,
		intents,
		runs: parts.runs,
		currentPage: readonly(parts.currentPage),
		api: parts.api,
		lastError: activity.lastError,
		restart: async () => {
			try {
				await parts.restartBackend();
			} finally {
				parts.controller.retry();
				void activity.refresh();
			}
		},
	};
}
