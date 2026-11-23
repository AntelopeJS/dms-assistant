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
import {
	computed,
	defineComponent,
	h,
	ref,
	shallowRef,
	toValue,
	watch,
	type MaybeRefOrGetter,
} from "vue";
import type { JsonValue } from "../../builder/app/runtime/types";
import ActivityDetail from "../../app/components/ActivityDetail.vue";
import ChangesView from "../../app/components/ChangesView.vue";
import ChangeSetPanel from "../../app/views/ChangeSetPanel.vue";
import UnavailableState from "../../app/views/UnavailableState.vue";
import { installApiErrorPresenter } from "../support/api-error-presenter";
import { hostRoute } from "../support/dms-frontend-module";

type Query = Record<string, string | number>;

interface Read {
	url: string;
	query?: Query;
}

type Backend = (read: Read) => JsonValue | Promise<JsonValue>;

interface FetchOptions {
	method?: string;
	body?: JsonValue;
	query?: Query;
}

type AuthFetch = (url: string, options?: FetchOptions) => Promise<JsonValue>;

let backend: Backend;
const reads: Read[] = [];
const authFetch = vi.fn<AuthFetch>();
/** The reads the page's refreshes read again, as the DMS's `refreshPageBlocks()` does. */
const pageReads = new Set<() => Promise<void>>();
const refreshPageBlocks = vi.fn(async () => {
	await Promise.all([...pageReads].map((refresh) => refresh()));
});

interface FakeApiDataOptions {
	query?: MaybeRefOrGetter<Query>;
	refreshOnPageRefresh?: boolean;
}

/** `useApiData` as the browser runs it: the page's reads answer from the backend, and a page refresh reads them again. */
function useApiData(
	url: MaybeRefOrGetter<string | null | undefined>,
	options: FakeApiDataOptions = {},
) {
	const data = shallowRef<JsonValue | null>(null);
	const error = ref<unknown>(null);
	const status = ref<"idle" | "pending" | "success" | "error">("idle");
	const request = () => ({ url: toValue(url), query: toValue(options.query) });
	async function refresh(): Promise<void> {
		const { url: target, query } = request();
		if (target == null) return;
		const read = query ? { url: target, query } : { url: target };
		reads.push(read);
		status.value = "pending";
		try {
			data.value = structuredClone(await backend(read));
			error.value = null;
			status.value = "success";
		} catch (failure) {
			error.value = failure;
			status.value = "error";
		}
	}
	watch(request, () => void refresh(), { deep: true, immediate: true });
	if (options.refreshOnPageRefresh !== false) pageReads.add(refresh);
	return {
		data,
		error,
		status,
		pending: computed(() => status.value === "pending"),
		placeholder: ref(false),
		refresh,
		execute: refresh,
		clear: () => undefined,
	};
}

interface FakePagedOptions {
	nextCursor: (
		page: JsonValue,
		pages: JsonValue[],
	) => number | null | undefined;
}

interface PagedContext {
	$authFetch: typeof authFetch;
	cursor: number | undefined;
	signal: AbortSignal;
}

/** `useApiPagedData` as the renderer runs it: one key, the pages it loaded, all read again on a refresh. */
function useApiPagedData(
	key: MaybeRefOrGetter<string>,
	handler: (context: PagedContext) => Promise<JsonValue>,
	options: FakePagedOptions,
) {
	const pages = shallowRef<JsonValue[]>([]);
	const next = ref<number | null>(null);
	const error = ref<unknown>(null);
	const status = ref<"idle" | "pending" | "success" | "error">("idle");
	const loadingMore = ref(false);
	const read = (cursor: number | undefined) =>
		handler({
			$authFetch: authFetch,
			cursor,
			signal: new AbortController().signal,
		});
	async function readPages(count: number): Promise<void> {
		status.value = "pending";
		const loaded: JsonValue[] = [];
		let cursor: number | undefined;
		try {
			for (let index = 0; index < count; index++) {
				const page = structuredClone(await read(cursor));
				loaded.push(page);
				const after = options.nextCursor(page, loaded) ?? null;
				next.value = after;
				if (after === null) break;
				cursor = after;
			}
			pages.value = loaded;
			error.value = null;
			status.value = "success";
		} catch (failure) {
			error.value = failure;
			status.value = "error";
		}
	}
	const refresh = () => readPages(Math.max(pages.value.length, 1));
	watch(
		() => toValue(key),
		() => void readPages(1),
		{ immediate: true },
	);
	pageReads.add(refresh);
	async function loadMore(): Promise<void> {
		if (next.value === null) return;
		loadingMore.value = true;
		try {
			const page = structuredClone(await read(next.value));
			pages.value = [...pages.value, page];
			next.value = options.nextCursor(page, pages.value) ?? null;
		} catch (failure) {
			error.value = failure;
		} finally {
			loadingMore.value = false;
		}
	}
	return {
		pages,
		error,
		status,
		pending: computed(() => status.value === "pending"),
		hasMore: computed(() => next.value !== null),
		loadingMore,
		loadMore,
		refresh,
	};
}

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
	reads.length = 0;
	authFetch.mockReset();
	hostRoute.query = {};
	pageReads.clear();
	refreshPageBlocks.mockClear();
	vi.stubGlobal("useApiData", useApiData);
	vi.stubGlobal("useApiPagedData", useApiPagedData);
	vi.stubGlobal("refreshPageBlocks", refreshPageBlocks);
	vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
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
		backend = () => ({ ...ROW, args: { file_path: "src/pages/home.ts" } });
		const wrapper = mount(ActivityDetail, { rowData: ROW });
		await flushPromises();
		expect(reads).toEqual([{ url: "/ai/activity/act-1" }]);
		expect(authFetch).not.toHaveBeenCalled();
		expect(wrapper.findComponent(UnavailableState).exists()).toBe(false);
		expect(wrapper.find('[data-stub="USkeleton"]').exists()).toBe(false);
	});

	it("says the assistant is not running on a 503, and reads again on retry", async () => {
		backend = () => {
			throw unavailable();
		};
		const wrapper = mount(ActivityDetail, { rowData: ROW });
		await flushPromises();
		const state = wrapper.findComponent(UnavailableState);
		expect(state.props("failure")).toBe("unavailable");
		backend = () => ROW;
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
		backend = changesBackend;
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
		backend = changesBackend;
		const wrapper = mount(ChangesView);
		await flushPromises();
		expect(wrapper.findComponent(ChangeSetPanel).props("changeSetId")).toBe(
			"cs-1",
		);
	});

	it("appends the next page on Load more, and reads every loaded page again on a page refresh", async () => {
		backend = changesBackend;
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
		backend = changesBackend;
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
		backend = () => ({
			changeSet: { ...summary("cs-1", 1), state: "undone" },
			files: [],
		});
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
		backend = () => ({
			changeSet: { ...summary("cs-1", 1), state: "undone" },
			files: [],
		});
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
