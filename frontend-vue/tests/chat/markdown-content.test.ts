// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import MarkdownContent from "../../app/chat/components/MarkdownContent.vue";

const STREAMED_RENDER_DELAY_MS = 50;

const ANSWER =
	"See [the docs](https://antelopejs.com).\n\n- one\n- two\n\n<img src=x onerror=alert(1)>";

const LINK =
	'<p>See <a href="https://antelopejs.com" target="_blank" rel="noopener noreferrer">the docs</a>.</p>\n';
const RAW_HTML_AS_TEXT = "<p>&lt;img src=x onerror=alert(1)&gt;</p>\n";

function list(last: string): string {
	return `<ul>\n<li>one</li>\n<li>${last}</li>\n</ul>\n`;
}

function scopeOf(wrapper: VueWrapper): string {
	const scope = [...wrapper.element.attributes].find((attribute) =>
		attribute.name.startsWith("data-v-"),
	);
	expect(scope).toBeDefined();
	return scope?.name ?? "";
}

/**
 * The markup the `v-html` version rendered for the same blocks: one
 * `display: contents` wrapper per block, each carrying the component's scope
 * id so its `:deep` styles reach the content.
 */
function expectBlocks(wrapper: VueWrapper, blocks: string[]): void {
	const scope = scopeOf(wrapper);
	const inner = blocks
		.map(
			(block) => `<div ${scope}="" class="chat-markdown-block">${block}</div>`,
		)
		.join("");
	expect(wrapper.element.outerHTML).toBe(
		`<div ${scope}="" class="chat-markdown">${inner}</div>`,
	);
}

function expectNoScriptVector(wrapper: VueWrapper): void {
	expect(wrapper.element.querySelector("img, script, [onerror]")).toBeNull();
}

async function nextFrame(): Promise<void> {
	vi.advanceTimersByTime(STREAMED_RENDER_DELAY_MS);
	await nextTick();
}

describe("MarkdownContent", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders a finished answer as one block, with raw HTML shown as text", () => {
		const wrapper = mount(MarkdownContent, { props: { content: ANSWER } });
		expectBlocks(wrapper, [LINK + list("two") + RAW_HTML_AS_TEXT]);
		expectNoScriptVector(wrapper);
	});

	it("renders a streaming answer once a frame, settled blocks apart from the open one", async () => {
		const wrapper = mount(MarkdownContent, {
			props: { content: ANSWER.slice(0, 50), isStreaming: true },
		});
		expectBlocks(wrapper, [""]);

		await nextFrame();
		expectBlocks(wrapper, [LINK, list("t")]);

		await wrapper.setProps({ content: ANSWER });
		await nextFrame();
		expectBlocks(wrapper, [LINK, list("two"), RAW_HTML_AS_TEXT]);
		expectNoScriptVector(wrapper);

		await wrapper.setProps({ isStreaming: false });
		expectBlocks(wrapper, [LINK + list("two") + RAW_HTML_AS_TEXT]);
	});

	describe("code block copy button", () => {
		const CODE = "const answer = 42;\n";
		const TWO_BLOCKS = "```ts\n" + CODE + "```\n\n```\nsecond\n```\n";
		const COPY_LABEL = "dms_assistant.panel.copy_code";
		const COPIED_LABEL = "✓ dms_assistant.common.copied";
		const COPIED_FOR_MS = 1_600;

		const writeText = vi.fn(async (_text: string) => undefined);

		beforeEach(() => {
			writeText.mockReset();
			writeText.mockResolvedValue(undefined);
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});
		});

		function buttons(wrapper: VueWrapper): HTMLButtonElement[] {
			const root: Element = wrapper.element;
			return [...root.querySelectorAll<HTMLButtonElement>("pre > button")];
		}

		it("gives each finished code block a named button that copies only its code", async () => {
			const wrapper = mount(MarkdownContent, {
				props: { content: TWO_BLOCKS },
			});
			const [first, second] = buttons(wrapper);
			expect(buttons(wrapper)).toHaveLength(2);
			expect(first?.getAttribute("aria-label")).toBe(COPY_LABEL);

			first?.click();
			await vi.advanceTimersByTimeAsync(0);
			expect(writeText).toHaveBeenCalledExactlyOnceWith(CODE);
			expect(first?.textContent).toBe(COPIED_LABEL);
			expect(second?.textContent).toBe(COPY_LABEL);

			await vi.advanceTimersByTimeAsync(COPIED_FOR_MS);
			expect(first?.textContent).toBe(COPY_LABEL);
		});

		it("keeps the button unchanged when the clipboard write fails", async () => {
			writeText.mockRejectedValue(new Error("denied"));
			const wrapper = mount(MarkdownContent, {
				props: { content: TWO_BLOCKS },
			});
			const [first] = buttons(wrapper);
			first?.click();
			await vi.advanceTimersByTimeAsync(0);
			expect(first?.textContent).toBe(COPY_LABEL);
		});

		it("adds no button to a code block that is still streaming", async () => {
			const wrapper = mount(MarkdownContent, {
				props: { content: "```ts\nconst answer", isStreaming: true },
			});
			await nextFrame();
			expect(wrapper.element.querySelector("pre")).not.toBeNull();
			expect(buttons(wrapper)).toHaveLength(0);

			await wrapper.setProps({
				content: "```ts\nconst answer = 42;\n```\n",
				isStreaming: false,
			});
			expect(buttons(wrapper)).toHaveLength(1);
		});
	});
});
