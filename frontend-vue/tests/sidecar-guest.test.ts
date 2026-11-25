import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick, ref, type Ref } from "vue";
import { assistantPlugin } from "../app/plugins/ai.client";
import type { SidecarInfoRead } from "../app/runtime/sidecar-status";

const plugin = assistantPlugin({ builderEnabled: false });

interface PluginHarness {
	useAuthFetch: ReturnType<typeof vi.fn>;
	unregisterSidePanel: ReturnType<typeof vi.fn>;
	useSidePanel: ReturnType<typeof vi.fn>;
	run: () => void | Promise<void>;
}

/** A first probe reporting a disabled sidecar stops the startup right after the authenticated fetch, which is all these tests need to observe. */
function disabledSidecarRead() {
	return {
		data: ref({ disabled: true }),
		error: ref(null),
		pending: ref(false),
		execute: async () => undefined,
		refresh: async () => undefined,
	};
}

/** A first probe that answers a running sidecar once `answer` is called. */
function heldSidecarRead() {
	let answer = (): void => undefined;
	const answered = new Promise<void>((resolve) => {
		answer = resolve;
	});
	return {
		answer: () => answer(),
		read: () => ({
			data: ref({ isRunning: true }),
			error: ref(null),
			pending: ref(false),
			execute: () => answered,
			refresh: async () => undefined,
		}),
	};
}

function loadPlugin(
	loggedIn: Ref<boolean>,
	sidecarRead: () => SidecarInfoRead = disabledSidecarRead,
): PluginHarness {
	const useAuthFetch = vi.fn(() => ({ $authFetch: vi.fn() }));
	const unregisterSidePanel = vi.fn();
	const useSidePanel = vi.fn();
	vi.stubGlobal("useDmsUserSession", () => ({ loggedIn }));
	vi.stubGlobal("useAuthFetch", useAuthFetch);
	vi.stubGlobal("useToast", () => ({ add: vi.fn() }));
	vi.stubGlobal("useDevReload", () => ({ awaitRoute: vi.fn() }));
	vi.stubGlobal("useApiData", sidecarRead);
	vi.stubGlobal("unregisterSidePanel", unregisterSidePanel);
	vi.stubGlobal("useSidePanel", useSidePanel);
	return {
		useAuthFetch,
		unregisterSidePanel,
		useSidePanel,
		run: () =>
			plugin({
				provide: vi.fn(),
				vueApp: createApp({}),
				$i18n: { t: (key: string) => key, locale: ref("en-GB") },
				hook: vi.fn(),
				runWithContext: <T>(callback: () => T) => callback(),
			}),
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

it("does not invoke authenticated fetching or inject the assistant for a guest", async () => {
	const harness = loadPlugin(ref(false));
	await harness.run();
	expect(harness.useAuthFetch).not.toHaveBeenCalled();
});

it("starts the assistant when a guest signs in without reloading the page", async () => {
	const loggedIn = ref(false);
	const harness = loadPlugin(loggedIn);
	await harness.run();
	expect(harness.useAuthFetch).not.toHaveBeenCalled();

	loggedIn.value = true;
	await nextTick();
	expect(harness.useAuthFetch).toHaveBeenCalledTimes(1);
});

it("withdraws the docked panel when the first probe finds no assistant", async () => {
	const harness = loadPlugin(ref(true));
	await harness.run();
	await vi.waitFor(() =>
		expect(harness.unregisterSidePanel).toHaveBeenCalledWith(
			"dms-assistant:assistant",
		),
	);
});

it("wires nothing and keeps the docked panel when the session ends during the first probe", async () => {
	const loggedIn = ref(true);
	const probe = heldSidecarRead();
	const harness = loadPlugin(loggedIn, probe.read);
	await harness.run();
	expect(harness.useAuthFetch).toHaveBeenCalledTimes(1);

	loggedIn.value = false;
	await nextTick();
	probe.answer();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(harness.useSidePanel).not.toHaveBeenCalled();
	expect(harness.unregisterSidePanel).not.toHaveBeenCalled();
});
