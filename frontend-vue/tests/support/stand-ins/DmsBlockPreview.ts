import { defineComponent, h } from "vue";

export const DmsBlockPreview = defineComponent({
	name: "DmsBlockPreview",
	props: {
		tree: { type: [Object, Array], required: true },
		blockTypes: { type: Object, default: undefined },
	},
	setup: (props) => () =>
		h(
			"div",
			{
				class: "dms-block-preview",
				"data-fetches-block-types": String(props.blockTypes === undefined),
			},
			JSON.stringify(props.tree),
		),
});
