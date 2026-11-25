import { nextTick, ref, watch } from "vue";
import { describe, expect, it, vi } from "vitest";
import { runWhileLoggedIn } from "../app/runtime/session-gate";

describe("session gate", () => {
	it("starts immediately when the session is already hydrated", () => {
		const start = vi.fn(() => () => undefined);
		runWhileLoggedIn(() => true, start);
		expect(start).toHaveBeenCalledTimes(1);
	});

	it("starts once the session appears, and once per session", async () => {
		const loggedIn = ref(false);
		const start = vi.fn(() => () => undefined);
		runWhileLoggedIn(() => loggedIn.value, start);
		expect(start).not.toHaveBeenCalled();

		loggedIn.value = true;
		await nextTick();
		expect(start).toHaveBeenCalledTimes(1);

		loggedIn.value = false;
		await nextTick();
		loggedIn.value = true;
		await nextTick();
		expect(start).toHaveBeenCalledTimes(2);
	});

	it("stops the run when the session ends, so a logout leaves nothing polling", async () => {
		const loggedIn = ref(true);
		const stopRun = vi.fn();
		runWhileLoggedIn(
			() => loggedIn.value,
			() => stopRun,
		);
		expect(stopRun).not.toHaveBeenCalled();

		loggedIn.value = false;
		await nextTick();
		expect(stopRun).toHaveBeenCalledTimes(1);
	});

	it("stops the live run when the gate itself is stopped, and only once", async () => {
		const loggedIn = ref(true);
		const stopRun = vi.fn();
		const stop = runWhileLoggedIn(
			() => loggedIn.value,
			() => stopRun,
		);

		stop();
		loggedIn.value = false;
		await nextTick();
		stop();
		expect(stopRun).toHaveBeenCalledTimes(1);
	});

	it("starts in the new session scope after login watchers settle, though the DMS hydrates the user before the session and its scope watcher clears outstanding reads, an AI probe started in the old scope included", async () => {
		const loggedIn = ref(false);
		const session = ref("guest");
		let scope = session.value;
		let probe: AbortController | undefined;
		let probeScope: string | undefined;
		runWhileLoggedIn(
			() => loggedIn.value,
			() => {
				probeScope = scope;
				probe = new AbortController();
				return () => undefined;
			},
		);
		const stopScope = watch(session, (next) => {
			probe?.abort();
			scope = next;
		});
		loggedIn.value = true;
		session.value = "owner";
		await nextTick();
		stopScope();
		expect(probeScope).toBe("owner");
		expect(probe?.signal.aborted).toBe(false);
	});

	it("never starts once the gate is stopped", async () => {
		const loggedIn = ref(false);
		const start = vi.fn(() => () => undefined);
		const stop = runWhileLoggedIn(() => loggedIn.value, start);

		stop();
		loggedIn.value = true;
		await nextTick();
		expect(start).not.toHaveBeenCalled();
	});
});
