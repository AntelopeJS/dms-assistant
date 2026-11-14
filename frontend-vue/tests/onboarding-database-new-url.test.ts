// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnect } from "../app/onboarding/connect-database";
import {
	type ConnectMemory,
	connectMemory,
} from "../app/onboarding/connect-memory";
import {
	analysisWith,
	fakeBuilder,
	LISTED,
	mountConnect,
	PROJECT,
	schemaCheck,
	unmountConnect,
	URL,
} from "./support/database-connect";

vi.mock("../builder/app/runtime/i18n", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	t: (key: string) => key,
}));

afterEach(() => {
	unmountConnect();
	vi.useRealTimers();
	window.sessionStorage.clear();
});

const CORRECTED = "postgres://app:fixed@db2.example.com/shop";

const ANALYSED = {
	...analysisWith([]),
	proposal: {
		...analysisWith([]).proposal,
		resources: [{ relation: "orders", tableView: { value: true } }],
	},
};

/**
 * A project that lists `shop` with the error of its old URL and its failed analysis until it
 * restarts on the URL the popup writes, as `ajs project dev -w` does once `.env` changes.
 */
function failedConnection() {
	let run = "run-before-the-url";
	const fake = fakeBuilder({
		projectModules: async () => ({ ...PROJECT, modules: ["builder-db-shop"] }),
		setConnectionUrl: vi.fn(async () => ({
			ok: true,
			data: { variable: "SHOP_URL" },
		})),
		projectRun: async () => ({ run }),
		databaseConnections: async () =>
			run === "run-before-the-url"
				? [{ ...LISTED, error: "password authentication failed" }]
				: [LISTED],
	});
	fake.setAnalysis({ id: "old-job", status: "failed", progress: {} });
	return {
		fake,
		restart: () => {
			run = "run-with-the-url";
			fake.setAnalysis(null);
		},
	};
}

function tabMemory(): ConnectMemory {
	return connectMemory(
		() => window.sessionStorage,
		() => "owner-1",
	);
}

function noCheckFailed(connect: DatabaseConnect): boolean {
	return connect.checks.value.every((check) => check.status !== "failed");
}

describe("a corrected URL for a connection that failed", () => {
	it("waits for the project to load it, then shows its analysis", async () => {
		vi.useFakeTimers();
		const { fake, restart } = failedConnection();
		const connect = mountConnect(fake.api, tabMemory());
		void connect.connect("postgres", CORRECTED);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(connect.phase.value.kind).toBe("analysing");
		expect(noCheckFailed(connect)).toBe(true);
		expect(fake.analyseDatabase).not.toHaveBeenCalled();

		restart();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(fake.analyseDatabase).toHaveBeenCalledWith(
			"shop",
			"builder-db-shop-tables",
			undefined,
		);
		fake.setAnalysis(ANALYSED);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(connect.phase.value).toMatchObject({
			kind: "analysed",
			connection: "shop",
		});
	});

	it("asks for a restart when the project keeps answering with the old URL", async () => {
		vi.useFakeTimers();
		const { fake } = failedConnection();
		const connect = mountConnect(fake.api, tabMemory());
		void connect.connect("postgres", CORRECTED);
		await vi.advanceTimersByTimeAsync(25_000);
		expect(schemaCheck(connect)).toEqual({
			key: "schema",
			status: "running",
			restart: true,
		});
	});

	it("resumes after a reload of the page while the project still answers with the old URL", async () => {
		vi.useFakeTimers();
		const { fake, restart } = failedConnection();
		const memory = tabMemory();
		void mountConnect(fake.api, memory).connect("postgres", CORRECTED);
		await vi.advanceTimersByTimeAsync(1_000);

		unmountConnect();
		const resumed = mountConnect(fake.api, memory);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(resumed.phase.value.kind).toBe("analysing");
		expect(noCheckFailed(resumed)).toBe(true);
		expect(memory.read()).toMatchObject({ connection: "shop" });

		restart();
		await vi.advanceTimersByTimeAsync(2_000);
		fake.setAnalysis(ANALYSED);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(resumed.phase.value).toMatchObject({
			kind: "analysed",
			connection: "shop",
		});
		expect(fake.api.setConnectionUrl).toHaveBeenCalledTimes(1);
	});
});
