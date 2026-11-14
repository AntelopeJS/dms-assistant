import { defineComponent, h } from "vue";

export const UFormField = defineComponent({
	name: "UFormField",
	setup:
		(_, { slots }) =>
		() =>
			h("div", slots.default?.()),
});
