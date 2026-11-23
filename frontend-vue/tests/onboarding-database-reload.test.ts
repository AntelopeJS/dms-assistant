/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnect } from "../app/onboarding/connect-database";
import {
	CONNECT_MEMORY_LIMIT_MS,
	type ConnectMemory,
	connectMemory,
} from "../app/onboarding/connect-memory";
import type { ProjectConfigResult } from "../builder/app/runtime/database-types";
import type { OpResult } from "../builder/app/runtime/types";
import {
	analysisOfOrders,
	analysisWith,
	answered,
	type BuilderApi,
	failedAnalysis,
	fakeBuilder,
	mountConnect,
	READER,
	unmountConnect,
	URL,
} from "./support/database-connect";
import { memoryConnects } from "./support/onboarding";

afterEach(() => {
	unmountConnect();
	vi.useRealTimers();
	window.sessionStorage.clear();
	window.localStorage.clear();
});

function browserStorage(): string {
	const entries = [window.sessionStorage, window.localStorage].flatMap(
		(storage) =>
			Array.from({ length: storage.length }, (_, index) => {
				const key = storage.key(index) ?? "";
				return `${key}=${storage.getItem(key) ?? ""}`;
			}),
	);
	return [...entries, document.cookie].join("\n");
}

const ANALYSED = analysisOfOrders();

function reload(api: BuilderApi, memory: ConnectMemory): DatabaseConnect {
	unmountConnect();
	return mountConnect(api, memory);
}

function slowWrite() {
	let answer: (result: OpResult<ProjectConfigResult>) => void = () => undefined;
	const fake = fakeBuilder({
		configureProject: vi.fn(
			() =>
				new Promise<OpResult<ProjectConfigResult>>((resolve) => {
					answer = resolve;
				}),
		),
	});
	return { api: fake.api, answer: () => answer(answered({ files: [] })) };
}

describe("a reload of the page while the connection loads", () => {
	it("follows the connection it wrote to its analysis, with the live check's answer, keeping no part of the URL in the browser", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder();
		const memory = connectMemory(
			() => window.sessionStorage,
			() => "owner-1",
		);
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
		const stored = browserStorage();
		expect(stored).toContain('"connection":"shop"');
		for (const part of [URL, "secret", "db.example.com"]) {
			expect(stored).not.toContain(part);
		}

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

	it.each([
		["its analysis failed", failedAnalysis("job1")],
		["the database has no table", analysisWith([])],
		["every table is mapped already", analysisWith([], ["orders"])],
	])("opens on the form once %s", async (_, analysis) => {
		vi.useFakeTimers();
		const fake = fakeBuilder();
		fake.setAnalysis(analysis);
		const memory = memoryConnects();
		void mountConnect(fake.api, memory).connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);

		expect(memory.read()).toBeNull();
	});
});

describe("a reload of the page while the connection loads, with a popup closed or replaced", () => {
	it("follows the connection it wrote when the popup closed before the write answered", async () => {
		vi.useFakeTimers();
		const closed = slowWrite();
		const memory = memoryConnects();
		void mountConnect(closed.api, memory).connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);
		unmountConnect();
		closed.answer();
		await vi.advanceTimersByTimeAsync(10);

		expect(mountConnect(closed.api, memory).phase.value).toEqual({
			kind: "analysing",
			connection: "shop",
			module: "builder-db-shop-tables",
		});
	});

	it("keeps the connection a reopened popup wrote over a write the closed one answers later", async () => {
		vi.useFakeTimers();
		const closed = slowWrite();
		const memory = memoryConnects();
		void mountConnect(closed.api, memory).connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);
		const reopened = reload(fakeBuilder().api, memory);
		void reopened.connect(
			"postgres",
			"postgres://app:secret@db.example.com/crm",
		);
		await vi.advanceTimersByTimeAsync(10);
		closed.answer();
		await vi.advanceTimersByTimeAsync(10);

		expect(memory.read()?.connection).toBe("crm");
	});

	it("keeps nothing from a write the closed popup answers after the reopened one went back to its form", async () => {
		vi.useFakeTimers();
		const closed = slowWrite();
		const memory = memoryConnects();
		void mountConnect(closed.api, memory).connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);
		reload(fakeBuilder().api, memory).reset();
		closed.answer();
		await vi.advanceTimersByTimeAsync(10);

		expect(memory.read()).toBeNull();
	});

	it("returns to the form and forgets a remembered connection the project no longer declares", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder({
			databaseConnection: async () => {
				throw { data: { code: "not_found" } };
			},
			databaseConnections: async () => [],
		});
		const memory = memoryConnects({
			engine: "postgres",
			connection: "gone",
			access: READER,
		});
		const resumed = mountConnect(fake.api, memory);
		await vi.advanceTimersByTimeAsync(10);

		expect(resumed.phase.value).toEqual({ kind: "form" });
		expect(memory.read()).toBeNull();
	});

	it("returns to the form and forgets a remembered connection once the time to follow it again ran out", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder();
		const memory = memoryConnects({
			engine: "postgres",
			connection: "shop",
			access: READER,
		});
		const resumed = mountConnect(fake.api, memory);
		await vi.advanceTimersByTimeAsync(CONNECT_MEMORY_LIMIT_MS - 2_000);
		expect(resumed.phase.value.kind).toBe("analysing");

		await vi.advanceTimersByTimeAsync(2_000);
		expect(resumed.phase.value).toEqual({ kind: "form" });
		expect(memory.read()).toBeNull();
	});
});
