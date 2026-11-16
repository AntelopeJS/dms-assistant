import { defineComponent, h } from "vue";

export const USwitch = defineComponent({
	name: "USwitch",
	inheritAttrs: false,
	props: {
		modelValue: { type: Boolean, default: false },
		disabled: { type: Boolean, default: false },
	},
	emits: ["update:modelValue"],
	setup:
		(props, { emit, attrs }) =>
		() =>
			h("button", {
				type: "button",
				role: "switch",
				"aria-label": attrs["aria-label"],
				"aria-checked": String(props.modelValue),
				disabled: props.disabled,
				onClick: () => emit("update:modelValue", !props.modelValue),
			}),
});
