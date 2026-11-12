import { type Ref, ref, shallowRef } from "vue";
import { SERVER_EVENT_TYPES } from "../../app/chat/constants/protocol";
import {
	type OnboardingHost,
	startOnboarding,
} from "../../app/onboarding/install";
import { PREFERENCES_KEY } from "../../app/onboarding/preferences";
import { CHANNEL_STATUS_CONNECTED } from "../../app/runtime/constants";
import { dmsState } from "./dms-state";
import { CLAUDE_LOGIN, onboardingState } from "./onboarding";

export const WIDGET_ID = "dms-assistant:onboarding";
export const CONVERSATION = { id: "c1", title: "Orders", updatedAtMs: 1 };

export interface RegisteredWidget {
	id: string;
	onSelectEvent?: string;
	badge?: string;
}

export function widget(): RegisteredWidget | undefined {
	const widgets = dmsState.get("dms-app-widgets")?.value as
		| RegisteredWidget[]
		| undefined;
	return widgets?.find((entry) => entry.id === WIDGET_ID);
}

export interface Backend {
	stateAnswers: Array<() => Promise<unknown>>;
	conversations: Array<typeof CONVERSATION>;
}

export function startWithBackend(
	backend: Backend,
	query: Record<string, string> = {},
) {
	const messageListeners: Array<(message: object) => void> = [];
	const route = ref({ path: "/", query });
	const provided = shallowRef(null) as OnboardingHost["provided"];
	const host: OnboardingHost = {
		session: {
			api: {
				get: async (path: string) => {
					if (path === "/ai/onboarding") {
						const next = backend.stateAnswers.shift();
						if (next === undefined) throw new Error("no more answers");
						return next();
					}
					throw Object.assign(new Error("not found"), { statusCode: 404 });
				},
				post: async () => undefined,
			},
			chat: {
				onMessage: (listener: (message: object) => void) => {
					messageListeners.push(listener);
					return () => undefined;
				},
				onReady: () => () => undefined,
				getStatus: () => CHANNEL_STATUS_CONNECTED,
				send: () => {
					messageListeners.forEach((listener) =>
						listener({
							type: SERVER_EVENT_TYPES.CONVERSATION_LIST,
							conversations: backend.conversations,
						}),
					);
					return true;
				},
			},
			holdStream: () => () => undefined,
		} as unknown as OnboardingHost["session"],
		router: {
			currentRoute: route as Ref<{
				path: string;
				query: Record<string, string>;
			}>,
			replace: async () => undefined,
		},
		provided,
		canConnectDatabase: true,
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
	dmsState.clear();
	window.localStorage.setItem(
		PREFERENCES_KEY,
		JSON.stringify({ dontShow: true, seenBootId: "boot-1" }),
	);
}

export function resetBrowser(): void {
	window.localStorage.clear();
	window.history.pushState({}, "", "/");
}
