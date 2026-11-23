/**
 * @fileoverview The markdown component's output.
 * @vitest-environment jsdom
 */
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
	const root: unknown = wrapper.element;
	const attributes = root instanceof Element ? [...root.attributes] : [];
	const scope = attributes.find((attribute) =>
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
});
