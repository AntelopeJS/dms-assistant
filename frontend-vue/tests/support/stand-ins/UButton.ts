import { defineComponent, h } from "vue";

/** Nuxt UI's button, drawn as a plain button with its label and slot. */
export const UButton = defineComponent({
	name: "UButton",
	inheritAttrs: false,
	props: {
		label: { type: String, default: "" },
		disabled: { type: Boolean, default: false },
		loading: { type: Boolean, default: false },
		type: { type: String, default: "button" },
	},
	emits: ["click"],
	setup(props, { slots, attrs, emit }) {
		return () =>
			h(
				"button",
				{
					...attrs,
					type: props.type,
					disabled: props.disabled,
					onClick: (event: MouseEvent) => emit("click", event),
				},
				[props.label, slots.default?.()],
			);
	},
});
