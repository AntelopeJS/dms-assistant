// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
	createHostCommandDispatcher,
	createNavigator,
	type DevReloadWaiter,
} from "../app/runtime/host-commands";

function navigateCommand(path: string): object {
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

describe("host command dispatch", () => {
	it("navigates only once the dev reload serves the target route", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({ router: { push }, devReload: waiter }),
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
			navigate: createNavigator({ router: { push }, devReload: waiter }),
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

	it("collapses a burst into a single trip to the newest path", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({ router: { push }, devReload: waiter }),
		});
		dispatch(navigateCommand("/stale"));
		dispatch(navigateCommand("/fresh"));
		await vi.waitFor(() => expect(calls).toEqual(["/fresh"]));
		release("/fresh");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/fresh"),
		);
	});

	it("keeps navigations in order when one arrives mid-wait", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({ router: { push }, devReload: waiter }),
		});
		dispatch(navigateCommand("/first"));
		await vi.waitFor(() => expect(calls).toEqual(["/first"]));
		dispatch(navigateCommand("/second"));
		// The second command must not overtake the first while it is still waiting.
		expect(calls).toEqual(["/first"]);
		release("/first");
		await vi.waitFor(() => expect(calls).toEqual(["/first", "/second"]));
		expect(push.mock.calls.flat()).toEqual(["/first"]);
		release("/second");
		await vi.waitFor(() =>
			expect(push.mock.calls.flat()).toEqual(["/first", "/second"]),
		);
	});

	it("ignores malformed payloads and unknown command types", async () => {
		const push = vi.fn();
		const awaitRoute = vi.fn(async () => true);
		const dispatch = createHostCommandDispatcher({
			navigate: createNavigator({
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

describe("the dashboard's own navigation to a page just written", () => {
	it("goes there only once the dev reload serves its route", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({ router: { push }, devReload: waiter });
		navigate("/shop/public-categories");
		await vi.waitFor(() => expect(calls).toEqual(["/shop/public-categories"]));
		expect(push).not.toHaveBeenCalled();
		release("/shop/public-categories");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith("/shop/public-categories"),
		);
	});

	it("shares one queue with the agent's navigations, the newest target winning", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({ router: { push }, devReload: waiter });
		const dispatch = createHostCommandDispatcher({ navigate });
		navigate("/first");
		await vi.waitFor(() => expect(calls).toEqual(["/first"]));
		dispatch(navigateCommand("/agent"));
		navigate("/mine");
		release("/first");
		await vi.waitFor(() => expect(calls).toEqual(["/first", "/mine"]));
		release("/mine");
		await vi.waitFor(() =>
			expect(push.mock.calls.flat()).toEqual(["/first", "/mine"]),
		);
	});

	it("waits on the page's own route and keeps its query and hash in the trip", async () => {
		const push = vi.fn();
		const { waiter, calls, release } = controlledWaiter();
		const navigate = createNavigator({ router: { push }, devReload: waiter });
		navigate("/modules/ai/changes?set=abc#top");
		await vi.waitFor(() => expect(calls).toEqual(["/modules/ai/changes"]));
		release("/modules/ai/changes");
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith(
				"/modules/ai/changes?set=abc#top",
			),
		);
	});
});
