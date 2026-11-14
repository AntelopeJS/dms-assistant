import { defineComponent, h, type PropType } from "vue";

export const UTabs = defineComponent({
	name: "UTabs",
	props: {
		modelValue: { type: String, default: "" },
		items: {
			type: Array as PropType<{ value: string; label: string }[]>,
			default: () => [],
		},
	},
	emits: ["update:modelValue"],
	setup:
		(props, { emit, attrs }) =>
		() =>
			h(
				"div",
				{ role: "tablist", "aria-label": attrs["aria-label"] },
				props.items.map((item) =>
					h(
						"button",
						{
							role: "tab",
							"aria-selected": item.value === props.modelValue,
							onClick: () => emit("update:modelValue", item.value),
						},
						item.label,
					),
				),
			),
});
