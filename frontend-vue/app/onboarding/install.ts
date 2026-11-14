import { type ShallowRef, watch } from "vue";
import { useDmsState } from "#dms/frontend-module";
import {
	API_PREFIX,
	APP_OVERLAYS_STATE_KEY,
} from "../../builder/app/runtime/constants";
import type { DatabaseConnection } from "../../builder/app/runtime/database-types";
import type { AssistantSession } from "../runtime/assistant-session";
import { createOnboardingApi } from "./api";
import { type ProjectContent, readConversations } from "./content";
import { connectMemory } from "./connect-memory";
import { createOnboarding, type OnboardingController } from "./controller";
import { LAUNCHER_ICON } from "../runtime/constants";
import { listMockups } from "./mockups";
import { preferenceStore } from "./preferences";
import { ONBOARDING_QUERY_PARAM } from "./public";
import {
	installDeepLink,
	ONBOARDING_COMPONENT_NAME,
	ONBOARDING_WIDGET_COMPONENT_NAME,
} from "./runtime";

const DATABASE_CONNECTIONS_PATH = `${API_PREFIX}/database/connections`;

/** What the onboarding takes from the dashboard once the assistant runs. */
export interface OnboardingHost {
	session: AssistantSession;
	router: {
		currentRoute: { value: { path: string; query: Record<string, string> } };
		replace: (path: string) => Promise<void>;
	};
	provided: ShallowRef<OnboardingController | null>;
	canConnectDatabase: boolean;
	/** The signed-in user's id: the connection the tab remembers belongs to that user. */
	userId: () => string | null;
	/** Resolves once the app is mounted: the overlay joins the page after hydration. */
	appMounted: Promise<void>;
	runWithContext: <T>(callback: () => T) => T;
}

/** The DMS's framed widgets, by the state key and the fields its dock reads. */
const APP_WIDGETS_STATE_KEY = "dms-app-widgets";
const WIDGET_ID = "dms-assistant:onboarding";

/** The `useDmsState` key the dock adds 1 to on each click of the assistant's chip, starting at 0. */
export const ONBOARDING_SELECTED_STATE_KEY =
	"dms-assistant:onboarding-selected";

interface AppWidget {
	id: string;
	icon: string;
	label: string;
	body: string;
	order?: number;
	/** A `useDmsState` key the dock adds 1 to on each click of the chip, starting at 0. */
	onSelectEvent?: string;
	/** A dot on the chip's corner while set; registering the widget again without it clears the dot. */
	badge?: "dot";
}

function widgetFor(needsAttention: boolean): AppWidget {
	const widget: AppWidget = {
		id: WIDGET_ID,
		icon: LAUNCHER_ICON,
		label: "$dms_assistant.views.onboarding.widget.label",
		body: ONBOARDING_WIDGET_COMPONENT_NAME,
		onSelectEvent: ONBOARDING_SELECTED_STATE_KEY,
	};
	return needsAttention ? { ...widget, badge: "dot" } : widget;
}

/**
 * Adds the popup to the overlays the DMS draws over every page, as the builder adds its own, and
 * the assistant's chip to the DMS widget dock, which unfolds its card on hover or focus. A click on the chip
 * opens the popup, and the chip carries a dot while the onboarding needs attention.
 */
function registerOverlay(controller: OnboardingController): () => void {
	const overlays = useDmsState<string[]>(APP_OVERLAYS_STATE_KEY, () => []);
	if (!overlays.value.includes(ONBOARDING_COMPONENT_NAME)) {
		overlays.value = [...overlays.value, ONBOARDING_COMPONENT_NAME];
	}
	const widgets = useDmsState<AppWidget[]>(APP_WIDGETS_STATE_KEY, () => []);
	const place = (needsAttention: boolean): void => {
		widgets.value = [
			...widgets.value.filter((widget) => widget.id !== WIDGET_ID),
			widgetFor(needsAttention),
		].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
	};
	const stopBadge = watch(controller.needsAttention, place, {
		immediate: true,
	});
	const selected = useDmsState<number>(ONBOARDING_SELECTED_STATE_KEY, () => 0);
	const stopSelect = watch(selected, () => controller.open());
	return () => {
		stopBadge();
		stopSelect();
		widgets.value = widgets.value.filter((widget) => widget.id !== WIDGET_ID);
	};
}

async function readDatabases(
	session: AssistantSession,
): Promise<DatabaseConnection[]> {
	const list = await session.api.get<unknown>(DATABASE_CONNECTIONS_PATH);
	return Array.isArray(list)
		? list.filter(
				(entry): entry is DatabaseConnection =>
					entry !== null &&
					typeof entry === "object" &&
					typeof Reflect.get(entry, "id") === "string",
			)
		: [];
}

async function readContent(
	session: AssistantSession,
	canConnectDatabase: boolean,
): Promise<ProjectContent> {
	const [conversations, mockups, databases] = await Promise.all([
		readConversations({ chat: session.chat, holdStream: session.holdStream }),
		listMockups((path) => session.api.get<unknown>(path)).catch(() => []),
		canConnectDatabase
			? readDatabases(session).catch(() => [])
			: Promise.resolve([]),
	]);
	return { conversations, mockups, databases };
}

/**
 * Starts the onboarding popup in a tab where the assistant runs: provides its controller, follows
 * `?assistant=connect`, and once the app is mounted and past the DMS's setup wizard reads whether
 * the popup opens, then registers the overlay and the widget, whether or not that read answered:
 * a backend that does not answer yet leaves the popup unavailable until a later `open` reads again,
 * or, while this tab follows a connection it wrote, until the controller's own read again answers.
 */
export function startOnboarding(host: OnboardingHost): () => void {
	const { session } = host;
	const controller = createOnboarding({
		api: createOnboardingApi({
			get: (path) => session.api.get<unknown>(path),
			post: (path, body) => session.api.post<unknown>(path, body),
		}),
		assistant: session,
		readContent: () => readContent(session, host.canConnectDatabase),
		preferences: preferenceStore(() => window.localStorage),
		canConnectDatabase: host.canConnectDatabase,
		connecting: connectMemory(() => window.sessionStorage, host.userId),
		openTab: (url) => void window.open(url, "_blank", "noopener"),
	});
	host.provided.value = controller;
	let isActive = true;
	let unregister = (): void => undefined;
	let stopLink = (): void => undefined;
	const wizard = afterSetupWizard(host.router);
	void host.appMounted
		.then(() => {
			if (!isActive) return;
			stopLink = installDeepLink({
				href: () => window.location.href,
				param: () =>
					host.router.currentRoute.value.query[ONBOARDING_QUERY_PARAM],
				replace: (path) => void host.router.replace(path),
				open: controller.open,
			});
			return wizard.done;
		})
		.then(() =>
			isActive ? controller.load().catch(() => undefined) : undefined,
		)
		.then(() => {
			if (isActive) {
				unregister = host.runWithContext(() => registerOverlay(controller));
			}
		})
		.catch(() => undefined);
	return () => {
		isActive = false;
		host.provided.value = null;
		wizard.stop();
		unregister();
		stopLink();
		controller.stop();
	};
}

/** The DMS's own setup wizard, where a project nobody has set up yet is sent. */
const SETUP_WIZARD_PATH = "/onboarding";

/** Resolves once the route is outside the DMS's setup wizard: the popup never covers it. */
function afterSetupWizard(router: OnboardingHost["router"]): {
	done: Promise<void>;
	stop: () => void;
} {
	const inWizard = (): boolean =>
		router.currentRoute.value.path.startsWith(SETUP_WIZARD_PATH);
	if (!inWizard()) return { done: Promise.resolve(), stop: () => undefined };
	let stop = (): void => undefined;
	const done = new Promise<void>((resolve) => {
		stop = watch(inWizard, (still) => {
			if (still) return;
			stop();
			resolve();
		});
	});
	return { done, stop: () => stop() };
}
