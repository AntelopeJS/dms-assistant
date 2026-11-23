import { defineComponent, h } from "vue";

export const UInput = defineComponent({
	name: "UInput",
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup:
		(props, { emit, attrs }) =>
		() =>
			h("input", {
				...attrs,
				value: props.modelValue,
				onInput: (event: Event) => {
					if (event.target instanceof HTMLInputElement) {
						emit("update:modelValue", event.target.value);
					}
				},
			}),
});
