/**
 * The workspace views read what they render with the DMS's `useApiData` and
 * `useApiPagedData`, which a server render hands to the browser and the
 * playground proves; these fakes read as the browser does, and `$authFetch` is
 * left to the writes.
 *
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import type { JsonValue } from "../../builder/app/runtime/types";
import ActivityDetail from "../../app/components/ActivityDetail.vue";
import ChangesView from "../../app/components/ChangesView.vue";
import ChangeSetPanel from "../../app/views/ChangeSetPanel.vue";
import UnavailableState from "../../app/views/UnavailableState.vue";
import {
	authFetch,
	installApiDataFakes,
	reads,
	refreshPageBlocks,
	setBackend,
	type Read,
} from "../support/api-data-fakes";
import { installApiErrorPresenter } from "../support/api-error-presenter";
import { hostRoute } from "../support/dms-frontend-module";

const Stub = (name: string) =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup:
			(_, { slots }) =>
			() =>
				h("div", { "data-stub": name }, slots.default?.()),
	});

const GLOBAL_STUBS = Object.fromEntries(
	[
		"DmsCardPanel",
		"DmsEmptyState",
		"DmsMasterDetail",
		"DmsSegmentedControl",
		"DmsKeyValueList",
		"DmsIconWell",
		"DmsEyebrowLabel",
		"DmsCodeSnippet",
		"UButton",
		"UInput",
		"USkeleton",
	].map((name) => [name, Stub(name)]),
);

const unavailable = () =>
	Object.assign(new Error("Service Unavailable"), {
		statusCode: 503,
		data: { message: "The assistant is not running" },
	});

const ROW = {
	id: "act-1",
	timestampMs: Date.UTC(2026, 9, 15, 10),
	tool: "Edit",
	target: "src/pages/home.ts",
	agent: "claude",
	allowedBy: "approved",
	result: "done",
	conversationId: "conv-1",
	conversationTitle: "Rename the home page",
	isReadOnly: false,
	isAutoFix: false,
};

const summary = (id: string, number: number) => ({
	id,
	number,
	title: `Change ${number}`,
	state: "applied",
	createdAtMs: Date.UTC(2026, 9, 15, 10),
	added: 1,
	removed: 0,
	scope: "safe",
	agent: "claude",
	files: [],
	isAutoFix: false,
	approvalsNeeded: 0,
	builderOps: 0,
	typecheck: "passed",
});

beforeEach(() => {
	hostRoute.query = {};
	installApiDataFakes();
	installApiErrorPresenter();
	vi.stubGlobal("useI18n", () => ({
		t: (key: string) => key,
		te: () => false,
	}));
	vi.stubGlobal("useRegionalFormat", () => ({
		dateTimeFormat: (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }),
	}));
	vi.stubGlobal("useToast", () => ({ add: vi.fn() }));
	vi.stubGlobal("useConfirmFrom", () => ({ confirmFrom: vi.fn() }));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const mount = (component: Parameters<typeof shallowMount>[0], props = {}) =>
	shallowMount(component, {
		props,
		global: { stubs: { ...GLOBAL_STUBS, UnavailableState: false } },
	});

function findButton(wrapper: VueWrapper, label: string) {
	return wrapper
		.findAllComponents({ name: "UButton" })
		.find((button) => button.vm.$attrs.label === label);
}

function requireButton(wrapper: VueWrapper, label: string) {
	const button = findButton(wrapper, label);
	if (!button) throw new Error(`No button labelled ${label}`);
	return button;
}

interface ValueItem {
	value: string;
}

function isValueItem(item: unknown): item is ValueItem {
	return (
		typeof item === "object" &&
		item !== null &&
		"value" in item &&
		typeof item.value === "string"
	);
}

function isValueItems(items: unknown): items is ValueItem[] {
	return Array.isArray(items) && items.every(isValueItem);
}

function valuesOf(items: unknown): string[] {
	return isValueItems(items) ? items.map((item) => item.value) : [];
}

function itemValues(wrapper: VueWrapper): string[] {
	return valuesOf(
		wrapper.findComponent({ name: "DmsMasterDetail" }).vm.$attrs.items,
	);
}

describe("activity detail", () => {
	it("reads the entry its row names with the page, not with $authFetch", async () => {
		setBackend(() => ({ ...ROW, args: { file_path: "src/pages/home.ts" } }));
		const wrapper = mount(ActivityDetail, { rowData: ROW });
		await flushPromises();
		expect(reads).toEqual([{ url: "/ai/activity/act-1" }]);
		expect(authFetch).not.toHaveBeenCalled();
		expect(wrapper.findComponent(UnavailableState).exists()).toBe(false);
		expect(wrapper.find('[data-stub="USkeleton"]').exists()).toBe(false);
	});

	it("says the assistant is not running on a 503, and reads again on retry", async () => {
		setBackend(() => {
			throw unavailable();
		});
		const wrapper = mount(ActivityDetail, { rowData: ROW });
		await flushPromises();
		const state = wrapper.findComponent(UnavailableState);
		expect(state.props("failure")).toBe("unavailable");
		setBackend(() => ROW);
		state.vm.$emit("retry");
		await flushPromises();
		expect(reads).toHaveLength(2);
		expect(wrapper.findComponent(UnavailableState).exists()).toBe(false);
	});
});

describe("changes view", () => {
	const PAGE = { results: [summary("cs-1", 1), summary("cs-2", 2)], total: 3 };
	const NEXT_PAGE = { results: [summary("cs-3", 3)], total: 3 };

	function changesBackend({ url, query }: Read): JsonValue {
		if (url === "/ai/status") return { checkpointsAvailable: true };
		if (url === "/ai/changes") return query?.offset ? NEXT_PAGE : PAGE;
		return { changeSet: summary("cs-1", 1), files: [] };
	}

	function listReads() {
		return authFetch.mock.calls.map(([url, options]) => [url, options?.query]);
	}

	beforeEach(() => {
		authFetch.mockImplementation(async (url, options) =>
			changesBackend({ url, query: options?.query }),
		);
	});

	it("reads the status and the first page with the page, and opens the set the URL names", async () => {
		setBackend(changesBackend);
		hostRoute.query = { set: "cs-2" };
		const wrapper = mount(ChangesView);
		await flushPromises();
		expect(reads).toEqual([{ url: "/ai/status" }]);
		expect(listReads()).toEqual([["/ai/changes", { offset: 0, limit: 30 }]]);
		expect(wrapper.findComponent(ChangeSetPanel).props("changeSetId")).toBe(
			"cs-2",
		);
	});

	it("selects the first set when the URL names none", async () => {
		setBackend(changesBackend);
		const wrapper = mount(ChangesView);
		await flushPromises();
		expect(wrapper.findComponent(ChangeSetPanel).props("changeSetId")).toBe(
			"cs-1",
		);
	});

	it("appends the next page on Load more, and reads every loaded page again on a page refresh", async () => {
		setBackend(changesBackend);
		const wrapper = mount(ChangesView);
		await flushPromises();
		const loadMore = "dms_assistant.views.common.load_more";
		requireButton(wrapper, loadMore).vm.$emit("click");
		await flushPromises();
		expect(listReads().at(-1)).toEqual([
			"/ai/changes",
			{ offset: 2, limit: 30 },
		]);
		expect(itemValues(wrapper)).toEqual(["cs-1", "cs-2", "cs-3"]);
		expect(findButton(wrapper, loadMore)).toBeUndefined();

		authFetch.mockClear();
		await refreshPageBlocks();
		await flushPromises();
		expect(listReads()).toEqual([
			["/ai/changes", { offset: 0, limit: 30 }],
			["/ai/changes", { offset: 2, limit: 30 }],
		]);
		expect(itemValues(wrapper)).toEqual(["cs-1", "cs-2", "cs-3"]);
	});

	it("reads the filtered first page when the scope changes", async () => {
		setBackend(changesBackend);
		const wrapper = mount(ChangesView);
		await flushPromises();
		wrapper
			.findComponent({ name: "DmsSegmentedControl" })
			.vm.$emit("update:modelValue", "vibe");
		await flushPromises();
		expect(listReads().at(-1)).toEqual([
			"/ai/changes",
			{ offset: 0, limit: 30, scope: "vibe", filter_scope: "is:vibe" },
		]);
	});
});

describe("change set panel", () => {
	it("refreshes the page once a set is redone, instead of reading on its own", async () => {
		setBackend(() => ({
			changeSet: { ...summary("cs-1", 1), state: "undone" },
			files: [],
		}));
		authFetch.mockResolvedValue({});
		const wrapper = mount(ChangeSetPanel, { changeSetId: "cs-1" });
		await flushPromises();
		expect(reads).toEqual([{ url: "/ai/changes/cs-1" }]);
		requireButton(wrapper, "dms_assistant.views.changes.redo").vm.$emit(
			"click",
		);
		await flushPromises();
		expect(authFetch).toHaveBeenCalledWith("/ai/changes/cs-1/redo", {
			method: "POST",
			body: {},
		});
		expect(refreshPageBlocks).toHaveBeenCalledTimes(1);
		expect(reads).toEqual([
			{ url: "/ai/changes/cs-1" },
			{ url: "/ai/changes/cs-1" },
		]);
	});
});

describe("change set actions", () => {
	it("stay busy until the page refresh a redo asks for is done", async () => {
		setBackend(() => ({
			changeSet: { ...summary("cs-1", 1), state: "undone" },
			files: [],
		}));
		authFetch.mockResolvedValue({});
		let finishRefresh: () => void = () => undefined;
		refreshPageBlocks.mockImplementationOnce(
			() => new Promise<void>((resolve) => (finishRefresh = resolve)),
		);
		const wrapper = mount(ChangeSetPanel, { changeSetId: "cs-1" });
		await flushPromises();
		const redo = () =>
			requireButton(wrapper, "dms_assistant.views.changes.redo");
		redo().vm.$emit("click");
		await flushPromises();
		expect(refreshPageBlocks).toHaveBeenCalledTimes(1);
		expect(redo().vm.$attrs.loading).toBe(true);
		finishRefresh();
		await flushPromises();
		expect(redo().vm.$attrs.loading).toBe(false);
	});
});
