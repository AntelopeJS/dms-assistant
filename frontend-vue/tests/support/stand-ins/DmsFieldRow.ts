import { defineComponent, h } from "vue";

export const DmsFieldRow = defineComponent({
	name: "DmsFieldRow",
	props: {
		label: { type: String, default: "" },
		description: { type: String, default: "" },
	},
	setup:
		(props, { slots }) =>
		() =>
			h("div", { class: "dms-field-row" }, [
				h("b", props.label),
				h("p", { class: "description" }, props.description),
				slots.default?.(),
				slots.details?.(),
			]),
});
