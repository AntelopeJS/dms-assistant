import { defineComponent, h } from "vue";

/** A modal that draws its slots in place while open. */
export const UModal = defineComponent({
	name: "UModal",
	props: {
		open: { type: Boolean, default: false },
		title: { type: String, default: "" },
	},
	setup(props, { slots }) {
		return () =>
			props.open
				? h("div", { class: "u-modal", role: "dialog" }, [
						h("h2", props.title),
						slots.body?.(),
						slots.footer?.(),
					])
				: null;
	},
});
