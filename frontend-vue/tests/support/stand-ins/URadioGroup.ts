import { defineComponent, h, type PropType } from "vue";

interface RadioItem {
	value: string;
	label: string;
	description?: string;
}

const radioItems: PropType<RadioItem[]> = Array;

export const URadioGroup = defineComponent({
	name: "URadioGroup",
	inheritAttrs: false,
	props: {
		modelValue: { type: String, default: "" },
		items: { type: radioItems, default: () => [] },
		disabled: { type: Boolean, default: false },
	},
	emits: ["update:modelValue"],
	setup:
		(props, { emit }) =>
		() =>
			h(
				"div",
				{ role: "radiogroup" },
				props.items.map((item) =>
					h(
						"button",
						{
							type: "button",
							role: "radio",
							"aria-checked": String(props.modelValue === item.value),
							disabled: props.disabled,
							onClick: () => emit("update:modelValue", item.value),
						},
						[h("b", item.label), h("span", item.description ?? "")],
					),
				),
			),
});
