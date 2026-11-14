import { vi } from "vitest";
import { shallowRef } from "vue";
import { CHAT_I18N_KEY } from "../../app/chat/composables/useChatI18n";
import type { OnboardingApi } from "../../app/onboarding/api";
import { NO_CONTENT, type ProjectContent } from "../../app/onboarding/content";
import {
	type ConnectMemory,
	connectMemory,
	type WrittenConnection,
} from "../../app/onboarding/connect-memory";
import type {
	OnboardingState,
	ProviderLogin,
} from "../../app/onboarding/contract";
import {
	createOnboarding,
	type OnboardingController,
} from "../../app/onboarding/controller";
import type {
	OnboardingPreferences,
	PreferenceStore,
} from "../../app/onboarding/preferences";
import { ONBOARDING_CONTROLLER_KEY } from "../../app/onboarding/runtime";
import views from "../../i18n/locales/dms-assistant-views-en-GB.json";
import { createTestI18n } from "./i18n";
import { OnboardingModal } from "./stand-ins/OnboardingModal";
import { UCheckbox } from "./stand-ins/UCheckbox";
import { UFormField } from "./stand-ins/UFormField";
import { PANEL_STUBS } from "./stubs";

export const SIGNED_OUT: ProviderLogin = { status: "signed-out" };

export const CLAUDE_LOGIN: ProviderLogin = {
	status: "signed-in",
	source: "saved",
	email: "owner@example.com",
	plan: "max",
};

export function onboardingState(
	logins: Partial<OnboardingState["logins"]> = {},
	overrides: Partial<OnboardingState> = {},
): OnboardingState {
	return {
		bootId: "boot-1",
		provider: "claude",
		logins: { claude: SIGNED_OUT, codex: SIGNED_OUT, ...logins },
		...overrides,
	};
}

/** Preferences kept in memory, as `localStorage` keeps them across controllers. */
export function memoryPreferences(
	initial: OnboardingPreferences = { dontShow: false, seenBootId: null },
): PreferenceStore & { saved: OnboardingPreferences } {
	const store = {
		saved: initial,
		read: () => store.saved,
		write: (next: OnboardingPreferences) => {
			store.saved = next;
		},
	};
	return store;
}

/** The tab's connect memory over a map, as `sessionStorage` keeps it across a reload of the tab. */
export function memoryConnects(
	initial: WrittenConnection | null = null,
): ConnectMemory {
	const items = new Map<string, string>();
	const memory = connectMemory(
		() => ({
			getItem: (key) => items.get(key) ?? null,
			setItem: (key, value) => {
				items.set(key, value);
			},
			removeItem: (key) => {
				items.delete(key);
			},
		}),
		() => "owner-1",
	);
	if (initial !== null) memory.write(memory.begin(), initial);
	return memory;
}

export interface OnboardingHarness {
	controller: OnboardingController;
	api: {
		readState: ReturnType<typeof vi.fn<OnboardingApi["readState"]>>;
		checkClaudeToken: ReturnType<
			typeof vi.fn<OnboardingApi["checkClaudeToken"]>
		>;
		setProvider: ReturnType<typeof vi.fn<OnboardingApi["setProvider"]>>;
		finishCodexSignIn: ReturnType<
			typeof vi.fn<OnboardingApi["finishCodexSignIn"]>
		>;
	};
	assistant: {
		startConversation: ReturnType<typeof vi.fn>;
		openConversation: ReturnType<typeof vi.fn>;
		navigate: ReturnType<typeof vi.fn>;
	};
	openTab: ReturnType<typeof vi.fn>;
	/** Changes what the project holds, as the next read of its content answers. */
	setContent: (next: ProjectContent) => void;
	/** What a mounted view injects: the controller and the views' English strings. */
	provide: Record<symbol, unknown>;
}

export interface HarnessOptions {
	state?: OnboardingState;
	content?: ProjectContent;
	preferences?: PreferenceStore;
	canConnectDatabase?: boolean;
	connecting?: ConnectMemory;
}

/** A controller over a backend that answers `state` until a test says otherwise. */
export function createOnboardingHarness(
	options: HarnessOptions = {},
): OnboardingHarness {
	const state = options.state ?? onboardingState();
	const api = {
		readState: vi.fn<OnboardingApi["readState"]>(async () => state),
		checkClaudeToken: vi.fn<OnboardingApi["checkClaudeToken"]>(async () => ({
			ok: false,
			reason: "rejected" as const,
		})),
		setProvider: vi.fn<OnboardingApi["setProvider"]>(async (provider) => ({
			...state,
			provider,
		})),
		finishCodexSignIn: vi.fn<OnboardingApi["finishCodexSignIn"]>(
			async () => undefined,
		),
	};
	const assistant = {
		startConversation: vi.fn(),
		openConversation: vi.fn(),
		navigate: vi.fn(),
	};
	const openTab = vi.fn();
	let content = options.content ?? NO_CONTENT;
	const controller = createOnboarding({
		api,
		assistant,
		readContent: async () => content,
		preferences: options.preferences ?? memoryPreferences(),
		canConnectDatabase: options.canConnectDatabase ?? true,
		connecting: options.connecting ?? memoryConnects(),
		openTab,
	});
	return {
		controller,
		api,
		assistant,
		openTab,
		setContent: (next) => {
			content = next;
		},
		provide: {
			[ONBOARDING_CONTROLLER_KEY]: shallowRef(controller),
			[CHAT_I18N_KEY]: createTestI18n(views),
		},
	};
}

/** The Nuxt UI and DMS components the onboarding draws, as light stand-ins. */
export const ONBOARDING_STUBS = {
	...PANEL_STUBS,
	UModal: OnboardingModal,
	UCheckbox,
	UFormField,
	DmsIconWell: true,
};
