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

const answer = {
	data: ref<typeof CANDIDATES | undefined>(CANDIDATES),
	pending: ref(false),
	failure: ref<string | null>(null),
	message: ref(""),
};

vi.mock("../app/views/composables/useAiData", () => ({
	useAiData: () => answer,
}));

const authFetch = vi.fn();
const presentError = vi.fn();

const SelectMenu = defineComponent({
	props: { modelValue: { type: String, default: undefined }, items: Array },
	emits: ["update:modelValue"],
	setup: () => () => h("div"),
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
				UBadge: Badge,
				UButton: Button,
				UIcon: true,
				UFormField: { template: "<div><slot /></div>" },
			},
		},
	});
	const field = (name: string) => {
		const found = wrapper.find(`[role="checkbox"][data-field="${name}"]`);
		if (!found.exists()) throw new Error(`no field ${name}`);
		return found;
	};
	const isExcluded = (name: string) =>
		field(name).attributes("aria-checked") === "true";
	return {
		wrapper,
		selects: wrapper.findAllComponents(SelectMenu),
		field,
		isExcluded,
		button: wrapper.findComponent(Button),
		onSuccessCallback,
	};
}

beforeEach(() => {
	answer.data.value = CANDIDATES;
	answer.pending.value = false;
	answer.failure.value = null;
	answer.message.value = "";
	authFetch.mockReset();
	presentError.mockReset();
	vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }));
	vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
	vi.stubGlobal("useApiErrorPresenter", () => ({ presentError }));
});

describe("the exclusion editor", () => {
	it("opens a picked route that already has exclusions with them checked, and saves the whole list", async () => {
		authFetch.mockResolvedValue({});
		const { selects, field, isExcluded, button, onSuccessCallback } =
			mountEditor();
		selects[0]?.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		expect(isExcluded("email")).toBe(true);
		expect(isExcluded("fax")).toBe(true);
		expect(isExcluded("name")).toBe(false);
		await field("name").trigger("click");
		await field("email").trigger("click");
		await flushPromises();
		button.vm.$emit("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledWith("/ai/exclusions", {
			method: "PUT",
			body: { route: "/api/customers", fields: ["fax", "name"] },
		});
		expect(onSuccessCallback).toHaveBeenCalledOnce();
	});

	it("shows a field's id next to its name, and not twice when they match", async () => {
		const { field } = mountEditor({ route: "/api/customers" });
		await flushPromises();
		expect(field("email").find("code").text()).toBe("email");
		expect(field("fax").find("code").exists()).toBe(false);
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
		const { selects, field, isExcluded, button } = mountEditor();
		selects[0]?.vm.$emit("update:modelValue", "/customers");
		await flushPromises();
		selects[0]?.vm.$emit("update:modelValue", "/invoices");
		await flushPromises();
		expect(selects[1]?.props("modelValue")).toBe("content");
		expect(isExcluded("total")).toBe(false);
		expect(() => field("email")).toThrow();
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

	it("saves nothing while the route's fields are still loading", async () => {
		answer.data.value = undefined;
		answer.pending.value = true;
		const { button } = mountEditor({ route: "/api/customers" });
		await flushPromises();
		expect(button.props("disabled")).toBe(true);
		button.vm.$emit("click");
		await flushPromises();
		expect(authFetch).not.toHaveBeenCalled();
	});

	it("says why and saves nothing when the route's fields cannot be read", async () => {
		answer.data.value = undefined;
		answer.failure.value = "error";
		answer.message.value = "The sitelayout could not be read";
		const { wrapper, button } = mountEditor({ route: "/api/customers" });
		await flushPromises();
		expect(wrapper.text()).toContain("The sitelayout could not be read");
		expect(button.props("disabled")).toBe(true);
		button.vm.$emit("click");
		await flushPromises();
		expect(authFetch).not.toHaveBeenCalled();
	});

	it("falls back to its own text when the failure has no message", async () => {
		answer.data.value = undefined;
		answer.failure.value = "unavailable";
		const { wrapper } = mountEditor({ route: "/api/customers" });
		await flushPromises();
		expect(wrapper.text()).toContain("dms_ai.views.exclusions.load_failed");
	});
});
