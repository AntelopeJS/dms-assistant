import { defineComponent, h } from "vue";

export const UKbd = defineComponent({
	name: "UKbd",
	props: { value: { type: String, default: "" } },
	setup: (props) => () => h("kbd", props.value),
});
