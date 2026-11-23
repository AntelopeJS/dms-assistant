/**
 * The renderer's runtime (`#dms/frontend-module`), which only the generated application provides:
 * `vitest.config.ts` aliases the import to this module, so a suite that mounts code reading the
 * renderer runs on this stand-in without mocking the module. A suite that needs more of the
 * runtime mocks `#dms/frontend-module` itself, which takes the place of this module whole.
 * @packageDocumentation
 */
import { ref } from "vue";

/** A widget the onboarding adds to the DMS's dock, by the fields the suites read. */
export interface RegisteredWidget {
	id: string;
	onSelectEvent?: string;
	badge?: string;
}

/** What the dashboard keeps under each `useDmsState` key the onboarding uses, as it starts a page load. */
function freshStates() {
	return {
		"dms-app-overlays": ref<string[]>([]),
		"dms-app-widgets": ref<RegisteredWidget[]>([]),
		"dms-assistant:onboarding-selected": ref(0),
	};
}

type DmsStates = ReturnType<typeof freshStates>;

type MessageParams = Record<string, number | string | boolean>;

let states = freshStates();
const requested = new Set<keyof DmsStates>();

/** The state the dashboard keeps under `key`, each one starting as the default the onboarding passes the real `useDmsState`. */
export function useDmsState<Key extends keyof DmsStates>(
	key: Key,
): DmsStates[Key] {
	requested.add(key);
	return states[key];
}

/** The state the code under test asked the dashboard for under `key`, when it did. */
export function dmsStateOf<Key extends keyof DmsStates>(
	key: Key,
): DmsStates[Key] | undefined {
	return requested.has(key) ? states[key] : undefined;
}

/** Forgets every state, as a new page load does. */
export function resetDmsState(): void {
	states = freshStates();
	requested.clear();
}

/** Hands the plugin back, as the renderer does before it runs it. */
export function defineDmsPlugin<Plugin>(definition: Plugin): Plugin {
	return definition;
}

/** The app's i18n composer, which answers a builder message's key, with its parameters when it has any. */
export function useDmsApp() {
	return {
		$i18n: {
			t: (path: string, params: MessageParams = {}): string => {
				const key = path.replace(/^dms_builder\./, "");
				return Object.keys(params).length === 0
					? key
					: `${key} ${JSON.stringify(params)}`;
			},
		},
	};
}

/** A router that goes nowhere. */
export function useDmsRouter() {
	return { push: async () => undefined };
}

/** The current route, which a suite has to mock to read: none is faked here. */
export function useDmsRoute(): never {
	throw new Error("Mock #dms/frontend-module in the suite that needs it");
}
