import { defineComponent, h } from "vue";

export const DmsEmptyState = defineComponent({
	name: "DmsEmptyState",
	props: {
		title: { type: String, default: "" },
		description: { type: String, default: "" },
	},
	setup:
		(props, { slots }) =>
		() =>
			h("div", { class: "dms-empty" }, [
				h("p", props.title),
				h("p", props.description),
				slots.actions?.(),
			]),
});
