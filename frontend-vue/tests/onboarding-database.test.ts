// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import {
	connectForm,
	type DatabaseConnect,
	useDatabaseConnect,
} from "../app/onboarding/connect-database";

vi.mock("../builder/app/runtime/i18n", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	t: (key: string, params?: Record<string, unknown>) =>
		params === undefined ? key : `${key} ${JSON.stringify(params)}`,
}));

const URL = "postgres://app:secret@db.example.com/shop";

const LISTED = {
	id: "shop",
	engine: "postgresql",
	version: "16",
	database: "shop",
	role: "reader",
};

const SCHEMAS_QUESTION = {
	id: "schemas:shop",
	kind: "schemas",
	question: "which",
	options: [
		{ value: "public", title: "public (4)" },
		{ value: "sales", title: "sales (9)" },
	],
	proposed: null,
};

function analysisWith(open: unknown[]) {
	return {
		id: "job1",
		status: "done",
		progress: {},
		proposal: {
			connection: "shop",
			module: "m",
			database: { engine: "postgresql", role: "reader", writes: "none" },
			resources: [],
			excluded: [],
			open,
		},
	};
}

function fakeBuilder(overrides: Record<string, unknown> = {}) {
	let analysis: unknown = null;
	const analyseDatabase = vi.fn(
		async (_connection: string, _module: string, _schemas?: string[]) => ({
			ok: true,
			data: {},
		}),
	);
	const configureProject = vi.fn(async () => ({ ok: true }));
	const api = {
		projectModules: async () => ({}),
		configureProject,
		failure: (error: unknown) => ({
			detail: error instanceof Error ? error.message : String(error),
		}),
		databaseConnection: async () => ({ wiring: { variable: "SHOP_URL" } }),
		databaseConnections: async () => [LISTED],
		latestAnalysis: async () =>
			analysis === null ? { ok: false } : { ok: true, data: analysis },
		analyseDatabase,
		...overrides,
	};
	return {
		api,
		analyseDatabase,
		configureProject,
		setAnalysis: (next: unknown) => {
			analysis = next;
		},
	};
}

let wrapper: VueWrapper | undefined;

function mountConnect(api: unknown): DatabaseConnect {
	let connect: DatabaseConnect | undefined;
	wrapper = mount(
		defineComponent({
			setup() {
				connect = useDatabaseConnect(api as never);
				return () => null;
			},
		}),
	);
	if (connect === undefined) throw new Error("the host did not set up");
	return connect;
}

function schemaCheck(connect: DatabaseConnect) {
	return connect.checks.value.find((check) => check.key === "schema");
}

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	vi.useRealTimers();
});

describe("the popup's connect form", () => {
	it.each([
		["a database name with no letter or digit", "postgres://app:secret@h/___"],
		[
			"a database name of non-ASCII letters only",
			"postgres://app:secret@h/%E9%A1%A7%E5%AE%A2",
		],
	])("names no connection for %s", (_, url) => {
		expect(connectForm("postgres", url)).toEqual({ kind: "no-name" });
	});

	it("refuses a URL without a user, with the builder's own words", () => {
		const form = connectForm("postgres", "postgres://db.example.com/orders");
		expect(form).toEqual({
			kind: "invalid",
			message: expect.stringContaining("database.connect.missing_user"),
		});
	});

	it("refuses a host the builder's form would refuse", () => {
		const form = connectForm("postgres", "postgres://app:secret@a_b!c/shop");
		expect(form).toEqual({
			kind: "invalid",
			message: "database.connect.problem_host",
		});
	});

	it("names the connection after the database when the builder's form accepts the URL", () => {
		expect(connectForm("postgres", URL)).toMatchObject({
			name: "shop",
			engine: "postgres",
		});
	});

	it("writes nothing into the project for a URL it refuses", async () => {
		const fake = fakeBuilder();
		const connect = mountConnect(fake.api);
		const problem = await connect.connect(
			"postgres",
			"postgres://app:secret@db.example.com/___",
		);
		expect(problem).toEqual({ kind: "no-name" });
		expect(fake.configureProject).not.toHaveBeenCalled();
		expect(connect.phase.value).toEqual({ kind: "form" });
	});
});

describe("following the connection's analysis", () => {
	it("answers the analysis's schemas question once, with the schemas the builder pre-checks", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder();
		const connect = mountConnect(fake.api);
		void connect.connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);
		expect(fake.analyseDatabase).toHaveBeenCalledTimes(1);
		fake.setAnalysis(analysisWith([SCHEMAS_QUESTION]));
		await vi.advanceTimersByTimeAsync(5_000);
		expect(fake.analyseDatabase).toHaveBeenCalledTimes(2);
		expect(fake.analyseDatabase).toHaveBeenLastCalledWith(
			"shop",
			expect.any(String),
			["public"],
		);
	});

	it("fails the schema check with the builder's refusal of the analysis, and stops polling", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder({
			analyseDatabase: vi.fn(async () => ({
				ok: false,
				error: { code: "unsupported", detail: "analysis refused" },
			})),
		});
		const connect = mountConnect(fake.api);
		void connect.connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(schemaCheck(connect)).toMatchObject({
			status: "failed",
			problem: "failed",
			error: "analysis refused",
		});
		expect(fake.api.analyseDatabase).toHaveBeenCalledTimes(1);
	});

	it("resolves into a failed schema check when the analysis request throws", async () => {
		vi.useFakeTimers();
		const fake = fakeBuilder({
			analyseDatabase: async () => {
				throw new Error("network down");
			},
		});
		const connect = mountConnect(fake.api);
		const outcome = connect.connect("postgres", URL).then(
			() => "resolved",
			(error: Error) => `rejected: ${error.message}`,
		);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(await outcome).toBe("resolved");
		expect(schemaCheck(connect)).toMatchObject({
			status: "failed",
			error: "network down",
		});
	});

	it("retries a failed analysis against the connection already written", async () => {
		vi.useFakeTimers();
		let refuse = true;
		const fake = fakeBuilder({
			analyseDatabase: vi.fn(async () =>
				refuse
					? { ok: false, error: { detail: "analysis refused" } }
					: { ok: true, data: {} },
			),
		});
		const connect = mountConnect(fake.api);
		void connect.connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(schemaCheck(connect)?.status).toBe("failed");

		refuse = false;
		void connect.connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(10);
		expect(schemaCheck(connect)?.status).toBe("running");
		expect(fake.api.analyseDatabase).toHaveBeenCalledTimes(2);
		expect(fake.configureProject).toHaveBeenCalledTimes(1);
	});
});
