/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import {
	type DatabaseConnect,
	useDatabaseConnect,
} from "../app/onboarding/connect-database";
import {
	analysisOfOrders,
	analysisWith,
	type BuilderApi,
	fakeBuilder,
	type LockHolder,
	READER,
	SCHEMAS_QUESTION as SCHEMAS_OF_SHOP,
} from "./support/database-connect";
import { memoryConnects } from "./support/onboarding";

const SCHEMAS_QUESTION = { ...SCHEMAS_OF_SHOP, id: "schemas:shop" };

const ANALYSED = analysisOfOrders();

/**
 * The browser's Web Locks, which every tab of the origin shares and a closed tab releases. A lock
 * is granted `grantMs` after the request, in a later task, as the browser grants it.
 */
function sharedLocks(grantMs = 0) {
	const held = new Set<string>();
	return {
		request: async (
			name: string,
			_options: LockOptions,
			callback: LockHolder,
		) => {
			if (held.has(name)) return callback(null);
			held.add(name);
			await new Promise((granted) => setTimeout(granted, grantMs));
			try {
				return await callback({ name, mode: "exclusive" });
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
function tab(api: BuilderApi) {
	const analyseDatabase = vi.fn(
		(...args: Parameters<typeof api.analyseDatabase>) =>
			api.analyseDatabase(...args),
	);
	let connect: DatabaseConnect | undefined;
	const memory = memoryConnects({
		engine: "postgres",
		connection: "shop",
		access: READER,
	});
	const wrapper = mount(
		defineComponent({
			setup() {
				connect = useDatabaseConnect({ ...api, analyseDatabase }, memory);
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

	it("leaves the lead to the other tab when it stops before its lock is granted", async () => {
		Object.defineProperty(window.navigator, "locks", {
			value: sharedLocks(50),
			configurable: true,
		});
		const fake = fakeBuilder();
		const first = tab(fake.api);
		await vi.advanceTimersByTimeAsync(10);
		first.connect.reset();
		const duplicate = tab(fake.api);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(first.analyseDatabase).not.toHaveBeenCalled();
		expect(duplicate.analyseDatabase).toHaveBeenCalled();
	});

	it("follows and analyses where the browser refuses its Web Locks", async () => {
		Object.defineProperty(window.navigator, "locks", {
			value: {
				request: () =>
					Promise.reject(new DOMException("denied", "SecurityError")),
			},
			configurable: true,
		});
		const fake = fakeBuilder();
		const only = tab(fake.api);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(only.analyseDatabase).toHaveBeenCalled();
	});
});
