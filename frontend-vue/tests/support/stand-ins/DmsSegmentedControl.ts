import { defineComponent, h, type PropType } from "vue";

interface SegmentItem {
	value: string;
	label: string;
}

const segmentItems: PropType<SegmentItem[]> = Array;

export const DmsSegmentedControl = defineComponent({
	name: "DmsSegmentedControl",
	props: {
		modelValue: { type: [String, Number], default: "" },
		items: { type: segmentItems, default: () => [] },
	},
	emits: ["update:modelValue"],
	setup:
		(props, { emit }) =>
		() =>
			h(
				"div",
				{ class: "dms-segmented" },
				props.items.map((item) =>
					h(
						"button",
						{
							type: "button",
							onClick: () => emit("update:modelValue", item.value),
						},
						item.label,
					),
				),
			),
});
