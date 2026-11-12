import { describe, expect, it } from "vitest";
import { computed, nextTick, ref } from "vue";
import { createMockupFold, isMockupPath } from "../app/runtime/mockup-fold";

function dashboard(path: string, isOpen: boolean) {
	const route = ref(path);
	const open = ref(isOpen);
	const panel = {
		isOpen: computed(() => open.value),
		open: () => {
			open.value = true;
		},
		close: () => {
			open.value = false;
		},
		toggle: () => {
			open.value = !open.value;
		},
	};
	const fold = createMockupFold({ path: route, panel });
	return { route, open, fold };
}

describe("which pages fold the panel", () => {
	it("folds on /mockup and the pages under it only (fails on a prefix match such as /mockups)", () => {
		expect(isMockupPath("/mockup")).toBe(true);
		expect(isMockupPath("/mockup/bikes")).toBe(true);
		expect(isMockupPath("/mockups")).toBe(false);
		expect(isMockupPath("/dashboard")).toBe(false);
	});
});

describe("the panel on a mockup", () => {
	it("closes an open panel and shows the bar when a mockup opens (fails when the panel stays docked)", async () => {
		const { route, open, fold } = dashboard("/dashboard", true);
		route.value = "/mockup";
		await nextTick();
		expect(open.value).toBe(false);
		expect(fold.isFolded.value).toBe(true);
	});

	it("opens the panel again when the mockup is left, if the fold closed it (fails when the panel stays closed)", async () => {
		const { route, open } = dashboard("/dashboard", true);
		route.value = "/mockup";
		await nextTick();
		route.value = "/dashboard";
		await nextTick();
		expect(open.value).toBe(true);
	});

	it("leaves a panel the person had closed closed after the mockup (fails when leaving always opens it)", async () => {
		const { route, open, fold } = dashboard("/dashboard", false);
		route.value = "/mockup";
		await nextTick();
		expect(fold.isFolded.value).toBe(true);
		route.value = "/dashboard";
		await nextTick();
		expect(open.value).toBe(false);
		expect(fold.isFolded.value).toBe(false);
	});

	it("folds a panel the dashboard opened on a mockup, as a reload does (fails when only a route change folds)", () => {
		const { open, fold } = dashboard("/mockup/bikes", true);
		expect(open.value).toBe(false);
		expect(fold.isFolded.value).toBe(true);
	});

	it("keeps the panel open on the mockup once the bar opened it, and when the mockup is left (fails when the fold closes it again)", async () => {
		const { route, open, fold } = dashboard("/mockup", false);
		fold.unfold();
		await nextTick();
		expect(open.value).toBe(true);
		expect(fold.isFolded.value).toBe(false);
		route.value = "/mockup/bikes";
		await nextTick();
		expect(open.value).toBe(true);
		route.value = "/dashboard";
		await nextTick();
		expect(open.value).toBe(true);
	});
});
