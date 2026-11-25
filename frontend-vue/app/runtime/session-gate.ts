import { watch } from "vue";

/**
 * Runs `start` for as long as the session lasts, and returns what stops the
 * gate and the run it started. Plugins run once, when the Vue app boots, on
 * whatever page the browser landed on, and neither signing in nor signing out
 * re-creates the app: each sign-in starts a run, and each sign-out calls the
 * stop that run returned, so nothing keeps reading routes that answer 401
 * once the session is gone. The watcher flushes after the render because
 * login also changes DMS's async-data scope: its watchers clear the old scope
 * before the probe starts, or they abort that read.
 */
export function runWhileLoggedIn(
	isLoggedIn: () => boolean,
	start: () => () => void,
): () => void {
	let stopRun: (() => void) | null = null;
	function follow(loggedIn: boolean): void {
		if (loggedIn) {
			stopRun ??= start();
			return;
		}
		const stop = stopRun;
		stopRun = null;
		stop?.();
	}
	follow(isLoggedIn());
	const stopWatching = watch(isLoggedIn, follow, { flush: "post" });
	return () => {
		stopWatching();
		follow(false);
	};
}
