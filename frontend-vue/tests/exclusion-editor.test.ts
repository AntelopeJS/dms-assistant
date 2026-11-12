// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import ExclusionEditor from "../app/components/ExclusionEditor.vue";

const CANDIDATES = {
	pages: [
		{
			path: "/customers",
			title: "Customers",
			tables: [{ id: "content", title: "All", route: "/api/customers" }],
		},
		{
			path: "/orders",
			title: "Orders",
			tables: [
				{ id: "open", title: "Open", route: "/api/orders" },
				{ id: "done", title: "Done", route: "/api/done" },
			],
		},
		{
			path: "/invoices",
			title: "Invoices",
			tables: [{ id: "content", title: "All", route: "/api/invoices" }],
		},
	],
	routes: [
		{
			route: "/api/customers",
			fields: [
				{ field: "name", header: "Name", isExcluded: false, isShown: true },
				{ field: "email", header: "Email", isExcluded: true, isShown: true },
				{ field: "fax", header: "fax", isExcluded: true, isShown: false },
			],
		},
		{
			route: "/api/invoices",
			fields: [
				{ field: "total", header: "Total", isExcluded: false, isShown: true },
			],
		},
	],
};

vi.mock("../app/views/composables/useAiData", () => ({
	useAiData: () => ({ data: ref(CANDIDATES), pending: ref(false) }),
}));

const authFetch = vi.fn();
const presentError = vi.fn();

const SelectMenu = defineComponent({
	props: { modelValue: { type: String, default: undefined }, items: Array },
	emits: ["update:modelValue"],
	setup: () => () => h("div"),
});
const Checkbox = defineComponent({
	props: { modelValue: Boolean, label: String },
	emits: ["update:modelValue"],
	setup: () => () => h("input"),
});
const Badge = defineComponent({
	props: { label: String },
	setup: () => () => h("span"),
});
const Button = defineComponent({
	props: { disabled: Boolean },
	emits: ["click"],
	setup: () => () => h("button"),
});

function mountEditor(rowData?: { route: string }) {
	const onSuccessCallback = vi.fn();
	const wrapper = mount(ExclusionEditor, {
		props: { rowData, onSuccessCallback },
		global: {
			stubs: {
				USelectMenu: SelectMenu,
				UCheckbox: Checkbox,
				UBadge: Badge,
				UButton: Button,
				UIcon: true,
				UFormField: { template: "<div><slot /></div>" },
			},
		},
	});
	const checkbox = (label: string) => {
		const found = wrapper
			.findAllComponents(Checkbox)
			.find((c) => c.props("label") === label);
		if (!found) throw new Error(`no checkbox ${label}`);
		return found;
	};
	return {
		wrapper,
		selects: wrapper.findAllComponents(SelectMenu),
		checkbox,
		button: wrapper.findComponent(Button),
		onSuccessCallback,
	};
}

beforeEach(() => {
	authFetch.mockReset();
	presentError.mockReset();
	vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }));
	vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
	vi.stubGlobal("useApiErrorPresenter", () => ({ presentError }));
});

describe("the exclusion editor", () => {
	it("opens a picked route that already has exclusions with them checked, and saves the whole list", async () => {
		authFetch.mockResolvedValue({});
		const { selects, checkbox, button, onSuccessCallback } = mountEditor();
		selects[0]?.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		expect(checkbox("Email").props("modelValue")).toBe(true);
		expect(checkbox("fax").props("modelValue")).toBe(true);
		expect(checkbox("Name").props("modelValue")).toBe(false);
		checkbox("Name").vm.$emit("update:modelValue", true);
		checkbox("Email").vm.$emit("update:modelValue", false);
		await flushPromises();
		button.vm.$emit("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledWith("/ai/exclusions", {
			method: "PUT",
			body: { route: "/api/customers", fields: ["fax", "name"] },
		});
		expect(onSuccessCallback).toHaveBeenCalledOnce();
	});

	it("marks an excluded field no table shows any more as not found", async () => {
		const { wrapper } = mountEditor({ route: "/api/customers" });
		await flushPromises();
		const badges = wrapper.findAllComponents(Badge);
		expect(badges.map((b) => b.props("label"))).toEqual([
			"dms_ai.views.exclusions.not_found",
		]);
	});

	it("edits the row's route without asking for a page", async () => {
		authFetch.mockResolvedValue({});
		const { selects, button } = mountEditor({ route: "/api/customers" });
		await flushPromises();
		expect(selects).toHaveLength(0);
		button.vm.$emit("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledWith("/ai/exclusions", {
			method: "PUT",
			body: { route: "/api/customers", fields: ["email", "fax"] },
		});
	});

	it("shows the new route's fields when another page has a table with the same id", async () => {
		const { selects, checkbox, button } = mountEditor();
		selects[0]?.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		selects[0]?.vm.$emit("update:modelValue", "/invoices");
		await flushPromises();
		expect(selects[1]?.props("modelValue")).toBe("content");
		expect(checkbox("Total").props("modelValue")).toBe(false);
		expect(() => checkbox("Email")).toThrow();
		expect(button.props("disabled")).toBe(false);
	});

	it("leaves the table to pick on a page with several, saving nothing until one is", async () => {
		const { selects, button } = mountEditor();
		selects[0]?.vm.$emit("update:modelValue", "/orders");
		await flushPromises();
		expect(selects[1]?.props("modelValue")).toBeUndefined();
		expect(button.props("disabled")).toBe(true);
	});

	it("presents the error and stays open when the save fails", async () => {
		authFetch.mockRejectedValue(new Error("nope"));
		const { button, onSuccessCallback } = mountEditor({
			route: "/api/customers",
		});
		await flushPromises();
		button.vm.$emit("click");
		await flushPromises();
		expect(presentError).toHaveBeenCalledOnce();
		expect(onSuccessCallback).not.toHaveBeenCalled();
	});
});
