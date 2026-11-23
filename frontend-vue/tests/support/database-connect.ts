import { mount, type VueWrapper } from "@vue/test-utils";
import { vi } from "vitest";
import { defineComponent } from "vue";
import {
	type DatabaseConnect,
	useDatabaseConnect,
} from "../../app/onboarding/connect-database";
import type { ConnectMemory } from "../../app/onboarding/connect-memory";
import type { useBuilderApi } from "../../builder/app/runtime/api";
import type {
	AnalysisState,
	ConnectionInfo,
	DatabaseAccess,
	DatabaseConnection,
	OpenItem,
	ProjectModules,
	ProposedResource,
} from "../../builder/app/runtime/database-types";
import type { OpResult } from "../../builder/app/runtime/types";
import { memoryConnects } from "./onboarding";

/** The builder's API client, which a test fakes call by call. */
export type BuilderApi = ReturnType<typeof useBuilderApi>;

export const URL = "postgres://app:secret@db.example.com/shop";

export const LISTED: DatabaseConnection = {
	id: "shop",
	engine: "postgresql",
	version: "16",
	database: "shop",
	role: "reader",
};

export const READER: DatabaseAccess = {
	reachable: true,
	latencyMs: 4,
	user: "reader",
	canRead: true,
	canWrite: false,
};

export const WRITER: DatabaseAccess = {
	...READER,
	user: "owner",
	canWrite: true,
};

export const PROJECT: ProjectModules = {
	modules: [],
	self: "dms",
	databasePins: [],
	dmsDatabase: "dms-database",
	ownDatabase: "mongodb",
	interfaceDatabase: "0.3.4",
	drivers: {
		postgres: { package: "@antelopejs/postgres", version: ">=0.2.6 <0.4.0" },
	},
};

/** What a connection wired into the project, as a project that lists `shop` by `SHOP_URL` answers. */
export const WIRED: ConnectionInfo = {
	wiring: {
		connection: "shop",
		driver: "@antelopejs/postgres",
		modules: [],
		unrecorded: [],
		ownsDriver: false,
		variable: "SHOP_URL",
		variables: ["SHOP_URL"],
	},
};

/** What the builder answers when an operation went through and changed nothing. */
export function answered<T>(data: T): OpResult<T> {
	return { ok: true, data, changes: [] };
}

/** What the builder answers when it refuses an operation. */
export function refused(detail: string) {
	return {
		ok: false as const,
		error: { code: "unsupported" as const, detail },
	};
}

/** What the builder answers once it wrote a connection's new URL into `.env`. */
export const URL_WRITTEN = answered({ variable: "SHOP_URL" });

/** What a Web Lock's holder receives: the lock granted, or none when another tab holds it. */
export interface LockGrant {
	name: string;
	mode: LockMode;
}

export type LockHolder = (lock: LockGrant | null) => Promise<void> | undefined;

/** The question of an analysis that asks which schemas to read. */
export const SCHEMAS_QUESTION: OpenItem = {
	id: "schemas",
	kind: "schemas",
	question: "which",
	options: [{ value: "public", title: "public (4)" }],
	proposed: null,
};

/** A relation the analysis proposes to map, with nothing in it but the table view. */
export function proposedRelation(relation: string): ProposedResource {
	return {
		relation,
		tableView: { value: true, rule: "test", kind: "fact" },
		writable: { value: false, rule: "test", kind: "default" },
		label: { value: null, rule: "test", kind: "default" },
		title: { value: relation, rule: "test", kind: "default" },
		fields: [],
		leftOut: [],
		writes: { insert: false, update: false, delete: false },
	};
}

const NO_PROGRESS = {
	relations: 0,
	described: 0,
	toProfile: 0,
	profiled: 0,
	timeouts: 0,
};

/** An analysis of `shop` that failed before it proposed anything. */
export function failedAnalysis(id: string): AnalysisState {
	return { id, connection: "shop", status: "failed", progress: NO_PROGRESS };
}

/** A finished analysis of `shop`, with the questions it left `open` and the relations `mapped` already. */
export function analysisWith(
	open: OpenItem[],
	mapped: string[] = [],
	resources: ProposedResource[] = [],
): AnalysisState {
	return {
		id: "job1",
		connection: "shop",
		status: "done",
		progress: NO_PROGRESS,
		proposal: {
			connection: "shop",
			module: "m",
			database: { engine: "postgresql", role: "reader", writes: "none" },
			resources,
			excluded: [],
			mapped,
			open,
		},
	};
}

/** A finished analysis of `shop` that proposes the `orders` relation. */
export function analysisOfOrders(): AnalysisState {
	return analysisWith([], [], [proposedRelation("orders")]);
}

async function unfaked(): Promise<never> {
	throw new Error("this builder call is not faked in the test");
}

/**
 * A builder API whose calls all answer a project that is ready to connect, apart from the `overrides`;
 * the analysis it holds is the one `setAnalysis` sets, and none until then.
 */
export function fakeBuilder(overrides: Partial<BuilderApi> = {}) {
	let analysis: AnalysisState | null = null;
	const analyseDatabase = vi.fn<BuilderApi["analyseDatabase"]>(async () =>
		answered(analysisWith([])),
	);
	const configureProject = vi.fn<BuilderApi["configureProject"]>(async () =>
		answered({ files: [] }),
	);
	const checkConnection = vi.fn<BuilderApi["checkConnection"]>(
		async () => READER,
	);
	const api: BuilderApi = {
		checkConnection,
		projectModules: async () => PROJECT,
		configureProject,
		failure: (error) => ({
			code: "unsupported",
			detail: error instanceof Error ? error.message : String(error),
		}),
		databaseConnection: async () => WIRED,
		databaseConnections: async () => [LISTED],
		latestAnalysis: async () =>
			analysis === null ? refused("none") : answered(analysis),
		analyseDatabase,
		reloadDue: async () => ({ due: false }),
		analysis: unfaked,
		mapping: unfaked,
		mapDatabase: unfaked,
		removeConnection: unfaked,
		setConnectionUrl: unfaked,
		...overrides,
	};
	return {
		api,
		checkConnection,
		analyseDatabase,
		configureProject,
		setAnalysis: (next: AnalysisState | null) => {
			analysis = next;
		},
	};
}

let wrapper: VueWrapper | undefined;

export function mountConnect(
	api: BuilderApi,
	memory: ConnectMemory = memoryConnects(),
): DatabaseConnect {
	let connect: DatabaseConnect | undefined;
	wrapper = mount(
		defineComponent({
			setup() {
				connect = useDatabaseConnect(api, memory);
				return () => null;
			},
		}),
	);
	if (connect === undefined) throw new Error("the host did not set up");
	return connect;
}

export function schemaCheck(connect: DatabaseConnect) {
	return connect.checks.value.find((check) => check.key === "schema");
}

/** Unmounts the host of the last `mountConnect`, as a closed popup or a reload of the page does. */
export function unmountConnect(): void {
	wrapper?.unmount();
	wrapper = undefined;
}
