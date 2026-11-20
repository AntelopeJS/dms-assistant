import { mount, type VueWrapper } from "@vue/test-utils";
import { vi } from "vitest";
import { defineComponent } from "vue";
import {
	type DatabaseConnect,
	useDatabaseConnect,
} from "../../app/onboarding/connect-database";
import type { ConnectMemory } from "../../app/onboarding/connect-memory";
import type { ProjectConfigStep } from "../../builder/app/runtime/database-types";
import { memoryConnects } from "./onboarding";

export const URL = "postgres://app:secret@db.example.com/shop";

export const LISTED = {
	id: "shop",
	engine: "postgresql",
	version: "16",
	database: "shop",
	role: "reader",
};

export const READER = {
	reachable: true,
	latencyMs: 4,
	user: "reader",
	canRead: true,
	canWrite: false,
};

export const WRITER = { ...READER, user: "owner", canWrite: true };

export const PROJECT = {
	modules: [] as string[],
	self: "dms",
	databasePins: [],
	dmsDatabase: "dms-database",
	ownDatabase: "mongodb",
	interfaceDatabase: "0.3.4",
	drivers: {
		postgres: { package: "@antelopejs/postgres", version: ">=0.2.6 <0.4.0" },
	},
};

export function analysisWith(open: unknown[], mapped: string[] = []) {
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
			mapped,
			open,
		},
	};
}

export function fakeBuilder(overrides: Record<string, unknown> = {}) {
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
		projectModules: async () => PROJECT,
		configureProject,
		failure: (error: unknown) => ({
			detail: error instanceof Error ? error.message : String(error),
		}),
		databaseConnection: async () => ({ wiring: { variable: "SHOP_URL" } }),
		databaseConnections: async () => [LISTED],
		latestAnalysis: async () =>
			analysis === null ? { ok: false } : { ok: true, data: analysis },
		analyseDatabase,
		reloadDue: async () => ({ due: false }),
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

export function mountConnect(
	api: unknown,
	memory: ConnectMemory = memoryConnects(),
): DatabaseConnect {
	let connect: DatabaseConnect | undefined;
	wrapper = mount(
		defineComponent({
			setup() {
				connect = useDatabaseConnect(api as never, memory);
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
