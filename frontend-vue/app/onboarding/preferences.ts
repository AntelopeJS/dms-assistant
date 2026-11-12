/** What this browser remembers of the popup. */
export interface OnboardingPreferences {
	/** "Don't show on startup" is ticked. */
	dontShow: boolean;
	/** The server start the popup last opened in. */
	seenBootId: string | null;
}

export interface PreferenceStore {
	read: () => OnboardingPreferences;
	write: (preferences: OnboardingPreferences) => void;
}

export const PREFERENCES_KEY = "dms-assistant:onboarding";

const DEFAULTS: OnboardingPreferences = { dontShow: false, seenBootId: null };

function parsed(text: string | null): OnboardingPreferences {
	if (text === null) return DEFAULTS;
	try {
		const value: unknown = JSON.parse(text);
		if (value === null || typeof value !== "object") return DEFAULTS;
		const dontShow = Reflect.get(value, "dontShow");
		const seenBootId = Reflect.get(value, "seenBootId");
		return {
			dontShow: dontShow === true,
			seenBootId: typeof seenBootId === "string" ? seenBootId : null,
		};
	} catch {
		return DEFAULTS;
	}
}

/** The preferences in `storage`, the browser's `localStorage`; a storage that refuses keeps the defaults. */
export function preferenceStore(storage: () => Storage): PreferenceStore {
	return {
		read: () => {
			try {
				return parsed(storage().getItem(PREFERENCES_KEY));
			} catch {
				return DEFAULTS;
			}
		},
		write: (preferences) => {
			try {
				storage().setItem(PREFERENCES_KEY, JSON.stringify(preferences));
			} catch {
				return;
			}
		},
	};
}
