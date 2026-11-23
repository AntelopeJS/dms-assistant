import { defineComponent, h } from "vue";

export const UTextarea = defineComponent({
	name: "UTextarea",
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup:
		(props, { emit }) =>
		() =>
			h("textarea", {
				class: "u-textarea",
				value: props.modelValue,
				onInput: (event: Event) => {
					if (event.target instanceof HTMLTextAreaElement) {
						emit("update:modelValue", event.target.value);
					}
				},
			}),
});
