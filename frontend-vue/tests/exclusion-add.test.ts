// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import ExclusionAdd from "../app/components/ExclusionAdd.vue";

const CANDIDATES = {
	pages: [
		{
			path: "/customers",
			title: "Customers",
			tables: [
				{
					id: "content",
					title: "All",
					route: "/api/customers",
					columns: [{ field: "email", header: "Email" }],
				},
			],
		},
		{
			path: "/orders",
			title: "Orders",
			tables: [
				{ id: "open", title: "Open", route: "/api/orders", columns: [] },
				{ id: "done", title: "Done", route: "/api/done", columns: [] },
			],
		},
		{
			path: "/invoices",
			title: "Invoices",
			tables: [
				{
					id: "content",
					title: "All",
					route: "/api/invoices",
					columns: [{ field: "total", header: "Total" }],
				},
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
const Button = defineComponent({
	props: { disabled: Boolean },
	emits: ["click"],
	setup: () => () => h("button"),
});

function mountDialog(onSuccessCallback = vi.fn()) {
	const wrapper = mount(ExclusionAdd, {
		props: { onSuccessCallback },
		global: {
			stubs: {
				USelectMenu: SelectMenu,
				UButton: Button,
				UFormField: { template: "<div><slot /></div>" },
			},
		},
	});
	const [page, table, column] = wrapper.findAllComponents(SelectMenu);
	if (!page || !table || !column) throw new Error("three selects expected");
	return {
		page,
		table,
		column,
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

describe("the add-exclusion dialog", () => {
	it("posts the picked table's route and column, then reports success", async () => {
		authFetch.mockResolvedValue({});
		const { page, table, column, button, onSuccessCallback } = mountDialog();
		page.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		expect(table.props("modelValue")).toBe("content");
		column.vm.$emit("update:modelValue", "email");
		await flushPromises();
		button.vm.$emit("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledWith("/ai/exclusions", {
			method: "POST",
			body: { route: "/api/customers", field: "email" },
		});
		expect(onSuccessCallback).toHaveBeenCalledOnce();
	});

	it("leaves the table to pick on a page with several, and clears the column", async () => {
		const { page, table, column } = mountDialog();
		page.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		column.vm.$emit("update:modelValue", "email");
		await flushPromises();
		page.vm.$emit("update:modelValue", "/orders");
		await flushPromises();
		expect(table.props("modelValue")).toBeUndefined();
		expect(column.props("modelValue")).toBeUndefined();
		expect(table.props("items")).toEqual([
			{ label: "Open", value: "open" },
			{ label: "Done", value: "done" },
		]);
	});

	it("clears the column when another page has a table with the same id", async () => {
		const { page, table, column, button } = mountDialog();
		page.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		column.vm.$emit("update:modelValue", "email");
		await flushPromises();
		page.vm.$emit("update:modelValue", "/invoices");
		await flushPromises();
		expect(table.props("modelValue")).toBe("content");
		expect(column.props("modelValue")).toBeUndefined();
		expect(button.props("disabled")).toBe(true);
	});

	it("says so and stays open when the save fails", async () => {
		authFetch.mockRejectedValue(new Error("nope"));
		const { page, column, button, onSuccessCallback } = mountDialog();
		page.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		column.vm.$emit("update:modelValue", "email");
		await flushPromises();
		button.vm.$emit("click");
		await flushPromises();
		expect(presentError).toHaveBeenCalledOnce();
		expect(onSuccessCallback).not.toHaveBeenCalled();
	});
});
