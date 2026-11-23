import { defineComponent, h, type PropType } from "vue";

interface MenuItem {
	label?: string;
	description?: string;
	onSelect?: () => void;
}

const menuItems: PropType<Array<MenuItem | MenuItem[]>> = Array;

/** A menu drawn open, each item a button, so tests can pick one. */
export const UDropdownMenu = defineComponent({
	name: "UDropdownMenu",
	props: { items: { type: menuItems, default: () => [] } },
	setup(props, { slots }) {
		const flat = (): MenuItem[] => props.items.flat(2);
		return () =>
			h("div", { class: "u-dropdown" }, [
				slots.default?.(),
				...flat()
					.filter((item) => item.onSelect !== undefined)
					.map((item) =>
						h(
							"button",
							{
								class: "u-dropdown-item",
								type: "button",
								"data-description": item.description,
								onClick: item.onSelect,
							},
							item.label,
						),
					),
			]);
	},
});
