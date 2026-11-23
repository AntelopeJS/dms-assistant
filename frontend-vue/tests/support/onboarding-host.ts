import { vi } from "vitest";
import { ref, shallowRef } from "vue";
import type { ChatApi } from "../../app/chat/composables/useChangeSetActions";
import { SERVER_EVENT_TYPES } from "../../app/chat/constants/protocol";
import {
	type OnboardingHost,
	startOnboarding,
} from "../../app/onboarding/install";
import type { OnboardingController } from "../../app/onboarding/controller";
import type { OnboardingState } from "../../app/onboarding/contract";
import { PREFERENCES_KEY } from "../../app/onboarding/preferences";
import { CHANNEL_STATUS_CONNECTED } from "../../app/runtime/constants";
import { dmsStateOf, resetDmsState } from "./dms-frontend-module";
import { CLAUDE_LOGIN, onboardingState } from "./onboarding";
import { createHarness } from "./panel-harness";

export const WIDGET_ID = "dms-assistant:onboarding";
export const CONVERSATION = { id: "c1", title: "Orders", updatedAtMs: 1 };

export function widget() {
	return dmsStateOf("dms-app-widgets")?.value.find(
		(entry) => entry.id === WIDGET_ID,
	);
}

export interface Backend {
	stateAnswers: Array<() => Promise<OnboardingState>>;
	conversations: Array<typeof CONVERSATION>;
}

export function startWithBackend(
	backend: Backend,
	query: Record<string, string> = {},
) {
	const base = createHarness();
	const route = ref({ path: "/", query });
	const provided = shallowRef<OnboardingController | null>(null);
	const api: ChatApi = {
		get: vi.fn().mockImplementation(async (path: string) => {
			if (path === "/ai/onboarding") {
				const next = backend.stateAnswers.shift();
				if (next === undefined) throw new Error("no more answers");
				return next();
			}
			throw Object.assign(new Error("not found"), { statusCode: 404 });
		}),
		post: vi.fn().mockResolvedValue(undefined),
	};
	const host: OnboardingHost = {
		session: {
			...base.session,
			api,
			chat: {
				...base.hub.transport,
				onReady: () => () => undefined,
				getStatus: () => CHANNEL_STATUS_CONNECTED,
				send: () => {
					base.hub.deliver({
						type: SERVER_EVENT_TYPES.CONVERSATION_LIST,
						conversations: backend.conversations,
					});
					return true;
				},
			},
			holdStream: () => () => undefined,
		},
		router: {
			currentRoute: route,
			replace: async () => undefined,
		},
		provided,
		canConnectDatabase: true,
		userId: () => "owner-1",
		appMounted: Promise.resolve(),
		runWithContext: (callback) => callback(),
	};
	const stop = startOnboarding(host);
	return { provided, stop };
}

export const UNFINISHED = async () =>
	onboardingState({ claude: CLAUDE_LOGIN }, { bootId: "boot-1" });

/** A browser that has seen this server start's popup and asked not to see it again at startup. */
export function silenceStartup(): void {
	resetDmsState();
	window.localStorage.setItem(
		PREFERENCES_KEY,
		JSON.stringify({ dontShow: true, seenBootId: "boot-1" }),
	);
}

export function resetBrowser(): void {
	window.localStorage.clear();
	window.history.pushState({}, "", "/");
}
