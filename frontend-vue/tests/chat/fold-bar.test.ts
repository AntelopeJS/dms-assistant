// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import FoldBar from "../../app/chat/components/FoldBar.vue";
import type { LauncherState } from "../../app/runtime/launcher-state";

describe("the folded assistant bar", () => {
	it("marks itself as a side rail, so the DMS keeps room for it beside docked surfaces", () => {
		const wrapper = mount(FoldBar, {
			props: {
				isFolded: ref(true),
				state: ref<LauncherState>("connected"),
				onUnfold: () => undefined,
			},
		});
		expect(wrapper.find("[data-dms-side-rail]").exists()).toBe(true);
		wrapper.unmount();
	});
});
