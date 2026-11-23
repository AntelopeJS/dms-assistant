/**
 * @fileoverview Copying assistant answers from the message list.
 * @vitest-environment jsdom
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import MessageList from "../../app/chat/components/MessageList.vue";
import { PANEL_STUBS } from "../support/stubs";

const COPY_LABEL = "dms_assistant.panel.copy_answer";
const COPIED_LABEL = "dms_assistant.common.copied";
const originalClipboard = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);

function mountAnswers() {
	return mount(MessageList, {
		props: {
			messages: [
				{ id: "one", role: "assistant", content: "First", timestampMs: 1 },
				{ id: "two", role: "assistant", content: "Second", timestampMs: 2 },
			],
			changeSets: {},
			busyChangeSetIds: new Set<string>(),
			requests: [],
			isRunning: false,
			progress: null,
			nowMs: 0,
			isStalled: false,
			stalledForMs: 0,
		},
		global: { stubs: PANEL_STUBS },
	});
}

function stubClipboard(writeText: (value: string) => Promise<void>): void {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
}

afterEach(() => {
	if (originalClipboard) {
		Object.defineProperty(navigator, "clipboard", originalClipboard);
	} else {
		Reflect.deleteProperty(navigator, "clipboard");
	}
	vi.useRealTimers();
});

describe("copying assistant answers", () => {
	it("shows feedback only on the last copied answer and resets it", async () => {
		vi.useFakeTimers();
		const writeText = vi.fn().mockResolvedValue(undefined);
		stubClipboard(writeText);
		const wrapper = mountAnswers();

		try {
			const [first, second] = wrapper.findAll(".cb-ai__actions button");
			await first.trigger("click");
			await nextTick();
			expect(writeText).toHaveBeenCalledWith("First");
			expect(first.attributes("icon")).toBe("i-ph-check");
			expect(first.text()).toBe(COPIED_LABEL);
			expect(second.attributes("aria-label")).toBe(COPY_LABEL);

			await second.trigger("click");
			await nextTick();
			expect(writeText).toHaveBeenCalledWith("Second");
			expect(first.attributes("aria-label")).toBe(COPY_LABEL);
			expect(second.attributes("aria-label")).toBe(COPIED_LABEL);

			await vi.advanceTimersByTimeAsync(1_600);
			expect(second.attributes("icon")).toBe("i-ph-copy");
			expect(second.attributes("aria-label")).toBe(COPY_LABEL);
		} finally {
			wrapper.unmount();
		}
	});

	it("does not show success after a failed clipboard write", async () => {
		stubClipboard(
			vi.fn().mockRejectedValue(new Error("Clipboard unavailable")),
		);
		const wrapper = mountAnswers();

		try {
			const first = wrapper.get(".cb-ai__actions button");
			await first.trigger("click");
			await flushPromises();
			expect(first.attributes("icon")).toBe("i-ph-copy");
			expect(first.attributes("aria-label")).toBe(COPY_LABEL);
		} finally {
			wrapper.unmount();
		}
	});
});
