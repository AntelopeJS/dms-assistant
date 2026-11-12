import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { linkedStep, withoutLinkedStep } from "../app/onboarding/deep-link";
import { installDeepLink } from "../app/onboarding/runtime";

describe("?assistant=connect", () => {
	it("asks for the connect form, and nothing else does", () => {
		expect(linkedStep("http://dms.test/orders?assistant=connect")).toBe(
			"connect-database",
		);
		expect(linkedStep("http://dms.test/orders?assistant=chat")).toBeNull();
		expect(linkedStep("http://dms.test/orders?tab=connect")).toBeNull();
	});

	it("leaves the address with every other parameter as written, in place, and the hash", () => {
		expect(
			withoutLinkedStep(
				"http://dms.test/orders?tab=open&assistant=connect&q=a%20b&tag=x&tag=y#totals",
			),
		).toBe("/orders?tab=open&q=a%20b&tag=x&tag=y#totals");
		expect(withoutLinkedStep("http://dms.test/orders?assistant=connect")).toBe(
			"/orders",
		);
	});

	it("opens the popup on load and after a later client navigation, then takes the parameter out", async () => {
		const href = ref("http://dms.test/orders?assistant=connect&tab=open");
		const param = ref<string | undefined>("connect");
		const open = vi.fn();
		const replace = vi.fn((path: string) => {
			href.value = `http://dms.test${path}`;
			param.value = undefined;
		});
		const stop = installDeepLink({
			href: () => href.value,
			param: () => param.value,
			replace,
			open,
		});
		expect(open).toHaveBeenCalledWith("connect-database");
		expect(replace).toHaveBeenLastCalledWith("/orders?tab=open");
		await nextTick();

		href.value = "http://dms.test/customers?assistant=connect#list";
		param.value = "connect";
		await nextTick();
		expect(open).toHaveBeenCalledTimes(2);
		expect(replace).toHaveBeenLastCalledWith("/customers#list");
		stop();
	});
});
