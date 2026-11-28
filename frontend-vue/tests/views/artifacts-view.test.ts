/**
 * The Artifacts page: the list read with the page, the artifact the URL names,
 * the search and kind filters, and Delete from the open artifact.
 *
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import type { JsonValue } from "../../builder/app/runtime/types";
import ArtifactsView from "../../app/components/ArtifactsView.vue";
import ArtifactPanel from "../../app/views/artifacts/ArtifactPanel.vue";
import { AI_ROUTES } from "../../app/views/constants";
import {
	authFetch,
	installApiDataFakes,
	reads,
	refreshPageBlocks,
	setBackend,
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
		"UButton",
		"UInput",
		"USkeleton",
	].map((name) => [name, Stub(name)]),
);

const DELETE_LABEL = "dms_assistant.views.artifacts.delete";

function summary(id: string, title: string, kind = "report") {
	return {
		id,
		conversationId: "c-1",
		agent: "claude",
		createdAtMs: Date.UTC(2026, 10, 27, 9, 30),
		kind,
		title,
		blocks: 1,
		createdBy: "Camille",
	};
}

const ALL = [
	summary("a-1", "Refunds Q3"),
	summary("a-2", "Top customers", "table"),
];

/** The sidecar's list, filtered as its route filters: the search over titles, the kind. */
function listPage(query: Record<string, string | number> | undefined) {
	const search = String(query?.search ?? "").toLowerCase();
	const kind = String(query?.filter_kind ?? "").replace(/^is:/, "");
	const results = ALL.filter(
		(artifact) =>
			artifact.title.toLowerCase().includes(search) &&
			(kind === "" || artifact.kind === kind),
	);
	return { results, total: results.length };
}

function detail(id: string): JsonValue {
	return {
		...summary(id, ""),
		spec: {
			title: `Artifact ${id}`,
			blocks: [{ type: "paragraph", text: "Body." }],
		},
	};
}

const confirmFrom = vi.fn(
	async (_url: string, options?: { onConfirm?: () => Promise<void> }) => {
		await options?.onConfirm?.();
		return true;
	},
);

beforeEach(() => {
	hostRoute.query = {};
	installApiDataFakes();
	installApiErrorPresenter();
	setBackend(({ url }) => detail(url.replace(`${AI_ROUTES.artifacts}/`, "")));
	authFetch.mockImplementation(async (url, options) =>
		options?.method === "DELETE" ? { deleted: url } : listPage(options?.query),
	);
	confirmFrom.mockClear();
	vi.stubGlobal("useConfirmFrom", () => ({ confirmFrom }));
	vi.stubGlobal("useI18n", () => ({
		t: (key: string) => key,
		te: () => false,
		locale: { value: "en-GB" },
	}));
	vi.stubGlobal("useRegionalFormat", () => ({
		dateTimeFormat: (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }),
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const mount = (
	component: Parameters<typeof shallowMount>[0],
	props = {},
	drawn: Record<string, false> = {},
) =>
	shallowMount(component, {
		props,
		global: {
			stubs: { ...GLOBAL_STUBS, UnavailableState: false, ...drawn },
		},
	});

/** The panel with its view drawn, so the Delete button in the view's actions slot is there to click. */
const mountPanel = (artifactId: string) =>
	mount(ArtifactPanel, { artifactId }, { ArtifactView: false });

function emptyStateTitle(wrapper: VueWrapper): unknown {
	return wrapper.findComponent({ name: "DmsEmptyState" }).vm.$attrs.title;
}

function listReads() {
	return authFetch.mock.calls
		.filter(([, options]) => options?.method !== "DELETE")
		.map(([url, options]) => [url, options?.query]);
}

function selectedId(wrapper: VueWrapper): string | undefined {
	const panel = wrapper.findComponent(ArtifactPanel);
	return panel.exists() ? panel.props("artifactId") : undefined;
}

describe("the Artifacts page", () => {
	it("reads the first page with the page and opens the artifact the URL names, the first one otherwise", async () => {
		hostRoute.query = { artifact: "a-2" };
		const named = mount(ArtifactsView);
		await flushPromises();
		expect(listReads()).toEqual([["/ai/artifacts", { offset: 0, limit: 30 }]]);
		expect(selectedId(named)).toBe("a-2");
		hostRoute.query = {};
		const first = mount(ArtifactsView);
		await flushPromises();
		expect(selectedId(first)).toBe("a-1");
	});

	it("reads the list again with the search and the kind, and says when nothing matches", async () => {
		const wrapper = mount(ArtifactsView);
		await flushPromises();
		wrapper
			.findComponent({ name: "UInput" })
			.vm.$emit("update:modelValue", "top");
		await flushPromises();
		expect(listReads().at(-1)).toEqual([
			"/ai/artifacts",
			{ offset: 0, limit: 30, search: "top" },
		]);
		expect(selectedId(wrapper)).toBe("a-2");
		wrapper
			.findComponent({ name: "DmsSegmentedControl" })
			.vm.$emit("update:modelValue", "chart");
		await flushPromises();
		expect(listReads().at(-1)).toEqual([
			"/ai/artifacts",
			{ offset: 0, limit: 30, search: "top", filter_kind: "is:chart" },
		]);
		expect(emptyStateTitle(wrapper)).toBe(
			"dms_assistant.views.artifacts.no_match_title",
		);
	});

	it("says no artifact yet when the list is empty without a filter", async () => {
		authFetch.mockResolvedValue({ results: [], total: 0 });
		const wrapper = mount(ArtifactsView);
		await flushPromises();
		expect(emptyStateTitle(wrapper)).toBe(
			"dms_assistant.views.artifacts.empty_title",
		);
		expect(selectedId(wrapper)).toBeUndefined();
	});

	it("drops the deleted artifact from the selection and the URL, and reads the list again", async () => {
		hostRoute.query = { artifact: "a-1" };
		window.history.replaceState(null, "", "/modules/ai/artifacts?artifact=a-1");
		const wrapper = mount(ArtifactsView);
		await flushPromises();
		authFetch.mockClear();
		wrapper.findComponent(ArtifactPanel).vm.$emit("deleted", "a-1");
		await flushPromises();
		expect(listReads()).toEqual([["/ai/artifacts", { offset: 0, limit: 30 }]]);
		expect(selectedId(wrapper)).toBe("a-1");
		expect(window.location.search).toBe("");
	});
});

describe("the artifact panel", () => {
	it("deletes from the dialog the server words, for the open artifact, then refreshes the page and says so (fails a Delete that skips the dialog)", async () => {
		const wrapper = mountPanel("a-1");
		await flushPromises();
		expect(reads).toEqual([{ url: "/ai/artifacts/a-1" }]);
		const remove = wrapper
			.findAllComponents({ name: "UButton" })
			.find((button) => button.vm.$attrs.label === DELETE_LABEL);
		if (!remove) throw new Error("no Delete button");
		remove.vm.$emit("click");
		await flushPromises();
		expect(confirmFrom).toHaveBeenCalledTimes(1);
		expect(confirmFrom.mock.calls[0]?.[0]).toBe(
			AI_ROUTES.artifactDeleteConfirm,
		);
		expect(confirmFrom.mock.calls[0]?.[1]).toMatchObject({
			params: { id: "a-1" },
		});
		expect(authFetch).toHaveBeenCalledWith("/ai/artifacts/a-1", {
			method: "DELETE",
		});
		expect(refreshPageBlocks).toHaveBeenCalledTimes(1);
		expect(wrapper.emitted("deleted")).toEqual([["a-1"]]);
	});

	it("deletes nothing when the dialog is declined", async () => {
		confirmFrom.mockResolvedValueOnce(false);
		const wrapper = mountPanel("a-1");
		await flushPromises();
		const remove = wrapper
			.findAllComponents({ name: "UButton" })
			.find((button) => button.vm.$attrs.label === DELETE_LABEL);
		remove?.vm.$emit("click");
		await flushPromises();
		expect(authFetch).not.toHaveBeenCalledWith("/ai/artifacts/a-1", {
			method: "DELETE",
		});
		expect(wrapper.emitted("deleted")).toBeUndefined();
	});
});
