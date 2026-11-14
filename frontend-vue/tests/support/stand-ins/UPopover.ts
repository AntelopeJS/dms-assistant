import { defineComponent, h } from "vue";

export const UPopover = defineComponent({
	name: "UPopover",
	setup:
		(_, { slots }) =>
		() =>
			h("div", { class: "u-popover" }, [slots.default?.(), slots.content?.()]),
});
