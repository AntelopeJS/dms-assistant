// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import {
	CONNECTABLE_ENGINES,
	connectForm,
	type DatabaseConnect,
	engineNames,
	useDatabaseConnect,
} from "../app/onboarding/connect-database";
import { ENGINES } from "../builder/app/runtime/database-connect";
import type { ProjectConfigStep } from "../builder/app/runtime/database-types";

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

const READER = {
	reachable: true,
	latencyMs: 4,
	user: "reader",
	canRead: true,
	canWrite: false,
};

const WRITER = { ...READER, user: "owner", canWrite: true };

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
	const configureProject = vi.fn(
		async (
			_steps: ProjectConfigStep[],
			_dryRun: boolean,
			_variables?: unknown,
		) => ({
			ok: true,
		}),
	);
	const api = {
		checkConnection: vi.fn(async () => READER),
		projectModules: async () => ({
			modules: [] as string[],
			dmsDatabase: "dms-database",
			ownDatabase: "mongodb",
		}),
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

function dmsDatabaseConfig(fake: ReturnType<typeof fakeBuilder>) {
	const steps = fake.configureProject.mock.calls[0]?.[0] ?? [];
	return steps.find((step) => step.id === "dms-database")?.entry?.config;
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

	it("points a connection an earlier visit already wrote at the new URL instead of adding its module again", async () => {
		const setConnectionUrl = vi.fn(async () => ({
			ok: true,
			data: { variable: "SHOP_URL" },
		}));
		const fake = fakeBuilder({
			projectModules: async () => ({ modules: ["builder-db-shop"] }),
			setConnectionUrl,
		});
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		expect(fake.configureProject).not.toHaveBeenCalled();
		expect(setConnectionUrl).toHaveBeenCalledWith(
			"shop",
			"postgres://app:secret@db.example.com:5432/shop",
		);
		expect(connect.refusal.value).toBeNull();
		expect(connect.phase.value).toMatchObject({
			kind: "analysing",
			connection: "shop",
		});
	});
});

describe("the live check before anything is written", () => {
	it.each([
		[
			"no server answers",
			{
				reachable: false,
				canRead: false,
				canWrite: false,
				reason: "Nothing is listening at this host and port.",
			},
			"reachable",
		],
		[
			"the server refuses the sign-in",
			{
				reachable: true,
				canRead: false,
				canWrite: false,
				reason: "password authentication failed",
			},
			"signed-in",
		],
		[
			"the account cannot read",
			{
				reachable: true,
				latencyMs: 3,
				user: "nobody",
				canRead: false,
				canWrite: false,
				reason: "This account cannot read this database.",
			},
			"read",
		],
	])(
		"writes nothing when %s, and fails that check with the reason",
		async (_, answer, key) => {
			const fake = fakeBuilder({ checkConnection: vi.fn(async () => answer) });
			const connect = mountConnect(fake.api);
			await connect.connect("postgres", URL);
			expect(fake.api.checkConnection).toHaveBeenCalledWith("postgres", URL);
			expect(fake.configureProject).not.toHaveBeenCalled();
			expect(fake.analyseDatabase).not.toHaveBeenCalled();
			expect(connect.checks.value.find((check) => check.key === key)).toEqual(
				expect.objectContaining({ status: "failed", error: answer.reason }),
			);
			expect(schemaCheck(connect)?.status).toBe("pending");
		},
	);

	it("fails the server check with the module's refusal when the check request itself is refused", async () => {
		const fake = fakeBuilder({
			checkConnection: vi.fn(async () => {
				throw new Error("Databases are checked in development only.");
			}),
		});
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		expect(fake.configureProject).not.toHaveBeenCalled();
		expect(connect.checks.value[0]).toEqual({
			key: "reachable",
			status: "failed",
			error: "Databases are checked in development only.",
		});
	});

	it("names the signed-in account and the latency it measured", async () => {
		const fake = fakeBuilder();
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		expect(connect.checks.value.slice(0, 3)).toEqual([
			{ key: "reachable", status: "done", latencyMs: 4 },
			{ key: "signed-in", status: "done", user: "reader" },
			{ key: "read", status: "done", canWrite: false },
		]);
	});
});

describe("the access written for the connection", () => {
	it("writes a read-only account's connection as read without asking", async () => {
		const fake = fakeBuilder();
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		expect(connect.phase.value.kind).not.toBe("choosing");
		expect(dmsDatabaseConfig(fake)).toEqual({
			externalConnections: { shop: { access: "read" } },
		});
	});

	it("waits for a choice when the account can write, then writes the access chosen", async () => {
		const fake = fakeBuilder({ checkConnection: vi.fn(async () => WRITER) });
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		expect(connect.phase.value).toEqual({ kind: "choosing" });
		expect(fake.configureProject).not.toHaveBeenCalled();

		await connect.choose("read-write");
		expect(dmsDatabaseConfig(fake)).toEqual({
			externalConnections: { shop: { access: "read-write" } },
		});
		expect(connect.phase.value).toMatchObject({ kind: "analysing" });
	});

	it("goes back to the form without writing when the choice is dropped", async () => {
		const fake = fakeBuilder({ checkConnection: vi.fn(async () => WRITER) });
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		connect.reset();
		await connect.choose("read-write");
		expect(connect.phase.value).toEqual({ kind: "form" });
		expect(fake.configureProject).not.toHaveBeenCalled();
	});

	it("offers no choice for a connection an earlier visit wrote, whose access it cannot raise", async () => {
		const setConnectionUrl = vi.fn(async () => ({
			ok: true,
			data: { variable: "SHOP_URL" },
		}));
		const fake = fakeBuilder({
			checkConnection: vi.fn(async () => WRITER),
			projectModules: async () => ({ modules: ["builder-db-shop"] }),
			setConnectionUrl,
		});
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		expect(connect.phase.value).toMatchObject({ kind: "analysing" });
		expect(setConnectionUrl).toHaveBeenCalledTimes(1);
		expect(fake.configureProject).not.toHaveBeenCalled();
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

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("an attempt the owner replaced", () => {
	it("writes the new URL of a database already connected under the same name", async () => {
		vi.useFakeTimers();
		const setConnectionUrl = vi.fn(async () => ({
			ok: true,
			data: { variable: "SHOP_URL" },
		}));
		const fake = fakeBuilder({
			setConnectionUrl,
			analyseDatabase: vi.fn(async () => ({
				ok: false,
				error: { detail: "analysis refused" },
			})),
		});
		const connect = mountConnect(fake.api);
		void connect.connect("postgres", URL);
		await vi.advanceTimersByTimeAsync(5_000);
		void connect.connect(
			"postgres",
			"postgres://app:secret@db2.example.com/shop",
		);
		await vi.advanceTimersByTimeAsync(10);
		expect(setConnectionUrl).toHaveBeenCalledWith(
			"shop",
			"postgres://app:secret@db2.example.com:5432/shop",
		);
		expect(fake.configureProject).toHaveBeenCalledTimes(1);
	});

	it("shows no refusal of a write the owner moved on from", async () => {
		const write = deferred<{ ok: false; error: { detail: string } }>();
		const fake = fakeBuilder({
			checkConnection: vi.fn(async () => WRITER),
			configureProject: vi.fn(() => write.promise),
		});
		const connect = mountConnect(fake.api);
		await connect.connect("postgres", URL);
		const chosen = connect.choose("read");
		connect.reset();
		await connect.connect(
			"postgres",
			"postgres://app:secret@db.example.com/orders",
		);
		write.resolve({ ok: false, error: { detail: "refusal of shop" } });
		await chosen;
		expect(connect.refusal.value).toBeNull();
		expect(connect.phase.value).toEqual({ kind: "choosing" });
	});

	it("starts no analysis once the step is gone", async () => {
		const answer = deferred<{ ok: false }>();
		let reads = 0;
		const fake = fakeBuilder({
			latestAnalysis: () => {
				reads += 1;
				return answer.promise;
			},
		});
		const connect = mountConnect(fake.api);
		const run = connect.connect("postgres", URL);
		await vi.waitFor(() => expect(reads).toBe(1));
		wrapper?.unmount();
		wrapper = undefined;
		answer.resolve({ ok: false });
		await run;
		expect(fake.analyseDatabase).not.toHaveBeenCalled();
	});

	it("leaves the next attempt's steps alone when the replaced one's build answer comes late", async () => {
		const answer = deferred<{ ok: false }>();
		let reads = 0;
		const fake = fakeBuilder({
			latestAnalysis: () => {
				reads += 1;
				return reads === 1 ? answer.promise : Promise.resolve({ ok: false });
			},
		});
		const connect = mountConnect(fake.api);
		const first = connect.connect("postgres", URL);
		await vi.waitFor(() => expect(reads).toBe(1));
		connect.reset();
		fake.api.checkConnection.mockImplementation(async () => WRITER);
		await connect.connect(
			"postgres",
			"postgres://app:secret@db.example.com/orders",
		);
		answer.resolve({ ok: false });
		await first;
		expect(fake.analyseDatabase).not.toHaveBeenCalled();
		expect(schemaCheck(connect)?.status).toBe("pending");
	});
});

describe("the engines the popup offers", () => {
	it.each([
		["en-GB", " or "],
		["fr-FR", " ou "],
	])(
		"names every engine the builder connects, as a choice, in %s",
		(locale, or) => {
			const names = engineNames(locale);
			for (const engine of CONNECTABLE_ENGINES) {
				expect(names).toContain(ENGINES[engine].label);
			}
			expect(CONNECTABLE_ENGINES).toHaveLength(Object.keys(ENGINES).length);
			expect(names).toContain(or);
		},
	);
});
