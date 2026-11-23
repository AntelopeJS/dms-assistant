import { defineComponent, h } from "vue";

export const UCheckbox = defineComponent({
	name: "UCheckbox",
	props: {
		modelValue: { type: Boolean, default: false },
		label: { type: String, default: "" },
	},
	emits: ["update:modelValue"],
	setup:
		(props, { emit }) =>
		() =>
			h("label", [
				h("input", {
					type: "checkbox",
					checked: props.modelValue,
					onChange: (event: Event) => {
						if (event.target instanceof HTMLInputElement) {
							emit("update:modelValue", event.target.checked);
						}
					},
				}),
				props.label,
			]),
});
