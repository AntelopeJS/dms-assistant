import { defineComponent, h } from "vue";

export const DmsCardPanel = defineComponent({
	name: "DmsCardPanel",
	props: { title: { type: String, default: "" } },
	setup:
		(props, { slots }) =>
		() =>
			h("section", { class: "dms-card" }, [
				h("h2", props.title),
				slots.default?.(),
			]),
});
