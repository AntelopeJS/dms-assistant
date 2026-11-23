import { defineComponent, h, type PropType } from "vue";

interface TabItem {
	value: string;
	label: string;
}

const tabItems: PropType<TabItem[]> = Array;

export const UTabs = defineComponent({
	name: "UTabs",
	props: {
		modelValue: { type: String, default: "" },
		items: { type: tabItems, default: () => [] },
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
