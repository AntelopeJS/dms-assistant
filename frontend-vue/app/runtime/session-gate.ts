import { watch } from "vue";

/**
 * Plugins run once, when the Vue app boots, on whatever page the browser landed
 * on. Landing on the sign-in screen means there is no session yet, and signing
 * in is a client-side navigation that never re-creates the app: a plugin that
 * gave up there would stay silent until the next full page load. Wait for the
 * session to appear instead, then run exactly once. The watcher flushes after
 * the render because login also changes DMS's async-data scope: its watchers
 * clear the old scope before the probe starts, or they abort that read.
 */
export function runWhenLoggedIn(
	isLoggedIn: () => boolean,
	start: () => void,
): () => void {
	if (isLoggedIn()) {
		start();
		return () => undefined;
	}
	const stop = watch(
		isLoggedIn,
		(loggedIn) => {
			if (!loggedIn) return;
			stop();
			start();
		},
		{ flush: "post" },
	);
	return stop;
}
