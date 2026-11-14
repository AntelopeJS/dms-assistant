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
					onChange: (event: Event) =>
						emit(
							"update:modelValue",
							(event.target as HTMLInputElement).checked,
						),
				}),
				props.label,
			]),
});
