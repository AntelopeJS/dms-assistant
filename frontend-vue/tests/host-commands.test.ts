/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { describe, expect, it, vi } from "vitest";
import {
	createHostCommandDispatcher,
	createNavigator,
	type DevReloadWaiter,
} from "../app/runtime/host-commands";

/** A dashboard that stays on its page while the trips wait. */
const here = (): string => "/home";

function navigateCommand(path: string) {
	return { type: "host_command_navigate", path };
}

interface ControlledWaiter {
	waiter: DevReloadWaiter;
	calls: string[];
	release: (path: string, served?: boolean) => void;
	reject: (path: string, err: Error) => void;
}

function controlledWaiter(): ControlledWaiter {
	const calls: string[] = [];
	const settlers = new Map<
		string,
		{ resolve: (served: boolean) => void; reject: (err: Error) => void }
	>();
	return {
		calls,
		release: (path, served = true) => settlers.get(path)?.resolve(served),
		reject: (path, err) => settlers.get(path)?.reject(err),
		waiter: {
			awaitRoute: (path) => {
				calls.push(path);
				return new Promise<boolean>((resolve, reject) => {
					settlers.set(path, { resolve, reject });
				});
			},
		},
	};
}

describe("host command dispatch, from the dev reload to the trip", () => {
	it("navigates only once the dev reload serves the target route", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: waiter,
			}),
		});
		dispatch(navigateCommand("/new-page"));
		await vi.waitFor(() => expect(calls).toEqual(["/new-page"]));
		expect(push).not.toHaveBeenCalled();
		release("/new-page");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/new-page"),
		);
	});

	it("navigates anyway when the route never comes back", async () => {
		const push = vi.fn();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: { awaitRoute: async () => false },
			}),
		});
		dispatch(navigateCommand("/deleted"));
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/deleted"),
		);
	});

	it("navigates anyway when the dev reload wait rejects", async () => {
		const push = vi.fn();
		const error = new Error("dev reload exploded");
		const { waiter, calls, reject } = controlledWaiter();
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: waiter,
			}),
		});
		dispatch(navigateCommand("/broken-wait"));
		await vi.waitFor(() => expect(calls).toEqual(["/broken-wait"]));
		reject("/broken-wait", error);
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/broken-wait"),
		);
		expect(logged).toHaveBeenCalledWith(
			expect.stringContaining("/broken-wait"),
			error,
		);
		logged.mockRestore();
	});
});

describe("host command dispatch, bursts, malformed commands and foreign paths", () => {
	it("collapses a burst into a single trip to the newest path", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: waiter,
			}),
		});
		dispatch(navigateCommand("/stale"));
		dispatch(navigateCommand("/fresh"));
		await vi.waitFor(() => expect(calls).toContain("/fresh"));
		release("/stale");
		release("/fresh");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/fresh"),
		);
	});

	it("lands on the newest target when one arrives mid-wait, never on the older one", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: waiter,
			}),
		});
		dispatch(navigateCommand("/first"));
		await vi.waitFor(() => expect(calls).toEqual(["/first"]));
		dispatch(navigateCommand("/second"));
		release("/first");
		await vi.waitFor(() => expect(calls).toEqual(["/first", "/second"]));
		expect(push).not.toHaveBeenCalled();
		release("/second");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/second"),
		);
	});

	it("ignores malformed payloads and unknown command types", async () => {
		const push = vi.fn();
		const awaitRoute = vi.fn(async () => true);
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: { awaitRoute },
			}),
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		dispatch("not an object");
		dispatch({ type: "host_command_unknown" });
		expect(push).not.toHaveBeenCalled();
		expect(awaitRoute).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("never sends the dashboard off its own origin, whatever the agent asks", async () => {
		const push = vi.fn();
		const awaitRoute = vi.fn(async () => true);
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: { awaitRoute },
			}),
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		for (const path of [
			"https://attacker.example/steal",
			"//attacker.example/steal",
			"/\\attacker.example/steal",
			"javascript:alert(document.cookie)",
			"relative/path",
			"",
		]) {
			dispatch(navigateCommand(path));
		}
		dispatch({ type: "host_command_navigate", path: 42 });
		await Promise.resolve();
		expect(push).not.toHaveBeenCalled();
		expect(awaitRoute).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("follows a path of the dashboard, query and hash included", async () => {
		const push = vi.fn();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
				location: here,
				router: { push },
				devReload: { awaitRoute: async () => true },
			}),
		});
		dispatch(navigateCommand("/modules/ai/settings?tab=1#top"));
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith(
				"/modules/ai/settings?tab=1#top",
			),
		);
	});
});

describe("the dashboard's own navigation to a page just written, once the dev reload serves it", () => {
	it("goes there only once the dev reload serves its route", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({
			location: here,
			router: { push },
			devReload: waiter,
		});
		navigate("/shop/public-categories");
		await vi.waitFor(() => expect(calls).toEqual(["/shop/public-categories"]));
		expect(push).not.toHaveBeenCalled();
		release("/shop/public-categories");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/shop/public-categories"),
		);
	});

	it("follows the newest target, whether the dashboard or the agent asked for it", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({
			location: here,
			router: { push },
			devReload: waiter,
		});
		const dispatch = createHostCommandDispatcher({ navigate });
		navigate("/first");
		dispatch(navigateCommand("/agent"));
		navigate("/mine");
		await vi.waitFor(() =>
			expect(calls).toEqual(["/first", "/agent", "/mine"]),
		);
		release("/first");
		release("/agent");
		release("/mine");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/mine"),
		);
	});

	it("opens a page that exists at once while the agent's trip to a page not written yet still waits", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({
			location: here,
			router: { push },
			devReload: waiter,
		});
		const dispatch = createHostCommandDispatcher({ navigate });
		dispatch(navigateCommand("/never-written"));
		await vi.waitFor(() => expect(calls).toEqual(["/never-written"]));
		navigate("/modules/ai/settings");
		await vi.waitFor(() =>
			expect(calls).toEqual(["/never-written", "/modules/ai/settings"]),
		);
		release("/modules/ai/settings");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/modules/ai/settings"),
		);
		release("/never-written", false);
		await Promise.resolve();
		expect(push).toHaveBeenCalledExactlyOnceWith("/modules/ai/settings");
	});
});

describe("the dashboard's own navigation to a page just written, while waits stall or are overtaken", () => {
	it("waits on the page's own route and keeps its query and hash in the trip", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({
			location: here,
			router: { push },
			devReload: waiter,
		});
		navigate("/modules/ai/changes?set=abc#top");
		await vi.waitFor(() => expect(calls).toEqual(["/modules/ai/changes"]));
		release("/modules/ai/changes");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith(
				"/modules/ai/changes?set=abc#top",
			),
		);
	});

	it("waits again while the project restart outlasts the host's own wait", async () => {
		const push = vi.fn();
		const answers = [false, false, true];
		const awaitRoute = vi.fn(async (_path: string) => answers.shift() ?? true);
		const navigate = createNavigator({
			location: here,
			router: { push },
			devReload: { awaitRoute },
		});
		navigate("/shop/public-categories");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/shop/public-categories"),
		);
		expect(awaitRoute).toHaveBeenCalledTimes(3);
	});

	it("stops waiting for a route once a newer navigation took over", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({
			location: here,
			router: { push },
			devReload: waiter,
		});
		navigate("/never");
		await vi.waitFor(() => expect(calls).toEqual(["/never"]));
		navigate("/new");
		release("/never", false);
		release("/new");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/new"),
		);
		expect(calls.filter((path) => path === "/never")).toHaveLength(1);
	});

	it("leaves the user on a page they opened while the route was awaited", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		let page = "/home";
		const navigate = createNavigator({
			location: () => page,
			router: { push },
			devReload: waiter,
		});
		navigate("/new");
		await vi.waitFor(() => expect(calls).toEqual(["/new"]));
		page = "/existing";
		release("/new");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(push).not.toHaveBeenCalled();
	});

	it("navigates within a minute even when one of the host's waits never settles", async () => {
		vi.useFakeTimers();
		try {
			const push = vi.fn();
			const navigate = createNavigator({
				location: here,
				router: { push },
				devReload: { awaitRoute: () => new Promise<boolean>(() => undefined) },
			});
			navigate("/new-page");
			await vi.advanceTimersByTimeAsync(59_000);
			expect(push).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1_000);
			expect(push).toHaveBeenCalledExactlyOnceWith("/new-page");
		} finally {
			vi.useRealTimers();
		}
	});
});
