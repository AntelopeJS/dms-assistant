import { defineComponent, h } from "vue";

export const DmsStatusPill = defineComponent({
	name: "DmsStatusPill",
	props: { label: { type: String, default: "" } },
	setup: (props) => () => h("span", { class: "dms-status-pill" }, props.label),
});
