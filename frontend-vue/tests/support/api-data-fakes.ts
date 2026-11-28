/**
 * The DMS's `useApiData` and `useApiPagedData` as the browser runs them, for the
 * suites that mount the workspace views: the page's reads answer from a backend
 * the suite sets, a page refresh reads them again, and `$authFetch` is left to
 * the writes.
 *
 * @packageDocumentation
 */
import { vi } from "vitest";
import {
	computed,
	ref,
	shallowRef,
	toValue,
	watch,
	type MaybeRefOrGetter,
} from "vue";
import type { JsonValue } from "../../builder/app/runtime/types";

export type Query = Record<string, string | number>;

export interface Read {
	url: string;
	query?: Query;
}

export type Backend = (read: Read) => JsonValue | Promise<JsonValue>;

interface FetchOptions {
	method?: string;
	body?: JsonValue;
	query?: Query;
}

type AuthFetch = (url: string, options?: FetchOptions) => Promise<JsonValue>;

let backend: Backend = () => null;

/** What the page's reads answer from now on. */
export function setBackend(next: Backend): void {
	backend = next;
}
export const reads: Read[] = [];
export const authFetch = vi.fn<AuthFetch>();
/** The reads the page's refreshes read again, as the DMS's `refreshPageBlocks()` does. */
export const pageReads = new Set<() => Promise<void>>();
export const refreshPageBlocks = vi.fn(async () => {
	await Promise.all([...pageReads].map((refresh) => refresh()));
});

interface FakeApiDataOptions {
	query?: MaybeRefOrGetter<Query>;
	refreshOnPageRefresh?: boolean;
}

/** `useApiData` as the browser runs it: the page's reads answer from the backend, and a page refresh reads them again. */
export function useApiData(
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
export function useApiPagedData(
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

/** Forgets every read and installs the fakes as the dashboard's auto-imports; call it in `beforeEach`. */
export function installApiDataFakes(): void {
	reads.length = 0;
	authFetch.mockReset();
	pageReads.clear();
	refreshPageBlocks.mockClear();
	vi.stubGlobal("useApiData", useApiData);
	vi.stubGlobal("useApiPagedData", useApiPagedData);
	vi.stubGlobal("refreshPageBlocks", refreshPageBlocks);
	vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
}
