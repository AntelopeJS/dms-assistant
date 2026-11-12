import { ref } from "vue";

/** The DMS's shared state, by key, as `useDmsState` hands it out. */
export const dmsState = new Map<string, { value: unknown }>();

/** Stands in for `#dms/frontend-module` in a suite that starts the onboarding. */
export const dmsModule = {
	useDmsState: (key: string, init: () => unknown) => {
		if (!dmsState.has(key)) dmsState.set(key, ref(init()));
		return dmsState.get(key);
	},
};
