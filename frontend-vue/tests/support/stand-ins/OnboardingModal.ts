import { defineComponent, h } from "vue";

/** A modal that draws its content in place while open. */
export const OnboardingModal = defineComponent({
	name: "UModal",
	props: { open: { type: Boolean, default: false } },
	setup(props, { slots }) {
		return () =>
			props.open
				? h("div", { class: "u-modal", role: "dialog" }, slots.content?.())
				: null;
	},
});
