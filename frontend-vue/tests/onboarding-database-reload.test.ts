// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnect } from "../app/onboarding/connect-database";
import type { ConnectMemory } from "../app/onboarding/connect-memory";
import {
	analysisWith,
	fakeBuilder,
	mountConnect,
	unmountConnect,
	URL,
} from "./support/database-connect";
import { memoryConnects } from "./support/onboarding";

vi.mock("../builder/app/runtime/i18n", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	t: (key: string) => key,
}));

afterEach(() => {
	unmountConnect();
	vi.useRealTimers();
});

describe("a reload of the page while the connection loads", () => {
	const ANALYSED = {
		...analysisWith([]),
		proposal: {
			...analysisWith([]).proposal,
			resources: [{ relation: "orders", tableView: { value: true } }],
		},
	};

	function reload(api: unknown, memory: ConnectMemory): DatabaseConnect {
		unmountConnect();
		return mountConnect(api, memory);
	}

	it("follows the connection it wrote to its analysis, with the live check's answer and no URL", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder();
		const memory = memoryConnects();
		void mountConnect(fake.api, memory).connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);

		const resumed = reload(fake.api, memory);
		expect(resumed.phase.value).toEqual({
			kind: "analysing",
			connection: "shop",
			module: "builder-db-shop-tables",
		});
		expect(resumed.checks.value.slice(0, 3)).toEqual([
			{ key: "reachable", status: "done", latencyMs: 4 },
			{ key: "signed-in", status: "done", user: "reader" },
			{ key: "read", status: "done", canWrite: false },
		]);
		expect(JSON.stringify(memory.read())).not.toContain("secret");

		fake.setAnalysis(ANALYSED);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(resumed.phase.value).toMatchObject({
			kind: "analysed",
			connection: "shop",
		});
		expect(fake.api.checkConnection).toHaveBeenCalledTimes(1);
		expect(fake.configureProject).toHaveBeenCalledTimes(1);
	});

	it("opens on the form once the analysis it followed is ready", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder();
		fake.setAnalysis(ANALYSED);
		const memory = memoryConnects();
		const connect = mountConnect(fake.api, memory);
		void connect.connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);
		expect(connect.phase.value.kind).toBe("analysed");

		expect(reload(fake.api, memory).phase.value).toEqual({ kind: "form" });
	});

	it("opens on the form after the owner went back to it", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder();
		const memory = memoryConnects();
		const connect = mountConnect(fake.api, memory);
		void connect.connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);
		connect.reset();

		expect(reload(fake.api, memory).phase.value).toEqual({ kind: "form" });
	});
});
