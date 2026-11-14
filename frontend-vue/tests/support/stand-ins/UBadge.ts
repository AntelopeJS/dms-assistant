import { defineComponent, h } from "vue";

export const UBadge = defineComponent({
	name: "UBadge",
	props: { label: { type: String, default: "" } },
	setup: (props) => () => h("span", { class: "u-badge" }, props.label),
});
