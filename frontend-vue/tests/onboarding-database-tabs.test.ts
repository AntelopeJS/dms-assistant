// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import {
	type DatabaseConnect,
	useDatabaseConnect,
} from "../app/onboarding/connect-database";
import {
	analysisWith,
	fakeBuilder,
	READER,
} from "./support/database-connect";
import { memoryConnects } from "./support/onboarding";

vi.mock("../builder/app/runtime/i18n", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	t: (key: string) => key,
}));

const SCHEMAS_QUESTION = {
	id: "schemas:shop",
	kind: "schemas",
	question: "which",
	options: [{ value: "public", title: "public (4)" }],
	proposed: null,
};

const ANALYSED = {
	...analysisWith([]),
	proposal: {
		...analysisWith([]).proposal,
		resources: [{ relation: "orders", tableView: { value: true } }],
	},
};

/** The browser's Web Locks, which every tab of the origin shares and a closed tab releases. */
function sharedLocks() {
	const held = new Set<string>();
	return {
		request: async (
			name: string,
			_options: { ifAvailable: boolean },
			callback: (lock: { name: string } | null) => unknown,
		): Promise<unknown> => {
			if (held.has(name)) return callback(null);
			held.add(name);
			try {
				return await callback({ name });
			} finally {
				held.delete(name);
			}
		},
	};
}

const tabs: VueWrapper[] = [];

/**
 * A tab that follows `shop`, remembered in its copy of the tab's storage, with its own analysis
 * requests counted.
 */
function tab(api: ReturnType<typeof fakeBuilder>["api"]) {
	const analyseDatabase = vi.fn(api.analyseDatabase);
	let connect: DatabaseConnect | undefined;
	const memory = memoryConnects({
		engine: "postgres",
		connection: "shop",
		access: READER,
	});
	const wrapper = mount(
		defineComponent({
			setup() {
				connect = useDatabaseConnect({ ...api, analyseDatabase } as never, memory);
				return () => null;
			},
		}),
	);
	tabs.push(wrapper);
	if (connect === undefined) throw new Error("the tab did not set up");
	return { connect, analyseDatabase, close: () => wrapper.unmount() };
}

beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(window.navigator, "locks", {
		value: sharedLocks(),
		configurable: true,
	});
});

afterEach(() => {
	for (const wrapper of tabs.splice(0)) wrapper.unmount();
	Reflect.deleteProperty(window.navigator, "locks");
	vi.useRealTimers();
});

describe("a tab duplicated while a connection loads", () => {
	it("starts one analysis for both tabs, and both show it", async () => {
		const fake = fakeBuilder();
		const first = tab(fake.api);
		const duplicate = tab(fake.api);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(
			first.analyseDatabase.mock.calls.length +
				duplicate.analyseDatabase.mock.calls.length,
		).toBeGreaterThan(0);
		expect(
			Math.min(
				first.analyseDatabase.mock.calls.length,
				duplicate.analyseDatabase.mock.calls.length,
			),
		).toBe(0);

		fake.setAnalysis(ANALYSED);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(first.connect.phase.value.kind).toBe("analysed");
		expect(duplicate.connect.phase.value.kind).toBe("analysed");
	});

	it("answers the analysis's schemas question from one tab only", async () => {
		const fake = fakeBuilder();
		fake.setAnalysis(analysisWith([SCHEMAS_QUESTION]));
		const first = tab(fake.api);
		const duplicate = tab(fake.api);
		await vi.advanceTimersByTimeAsync(3_000);
		const calls = [
			...first.analyseDatabase.mock.calls,
			...duplicate.analyseDatabase.mock.calls,
		];
		expect(calls).toEqual([["shop", "builder-db-shop-tables", ["public"]]]);
	});

	it("starts the analysis from the other tab once the one that led it closes", async () => {
		const fake = fakeBuilder();
		const first = tab(fake.api);
		const duplicate = tab(fake.api);
		await vi.advanceTimersByTimeAsync(2_000);
		const [leading, other] =
			first.analyseDatabase.mock.calls.length > 0
				? [first, duplicate]
				: [duplicate, first];
		expect(other.analyseDatabase).not.toHaveBeenCalled();

		leading.close();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(other.analyseDatabase).toHaveBeenCalled();
	});
});
