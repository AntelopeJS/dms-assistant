// @vitest-environment jsdom
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
	installAssistantPromptListener,
	MOCKUP_ASSISTANT_PROMPT_EVENT,
} from "../app/runtime/assistant-prompt";
import { intentOfPrompt } from "../app/runtime/panel-intents";
import { STORAGE_CONVERSATION_ID_KEY } from "../app/chat/constants/conversation";
import {
	CONVERSATION_ID,
	createHarness,
	type Harness,
	openPanel,
	sentOfType,
	unmountPanel,
} from "./support/panel-harness";

const BLOCK = {
	mockup: "bikes",
	page: "home",
	path: "grid.revenue",
	type: "ChartCard",
};

function dispatch(detail: unknown): CustomEvent {
	const event = new CustomEvent(MOCKUP_ASSISTANT_PROMPT_EVENT, {
		detail,
		cancelable: true,
	});
	window.dispatchEvent(event);
	return event;
}

beforeEach(() => {
	localStorage.setItem("dms-assistant-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
});

describe("the mockup editor's prompt event", () => {
	it("takes a valid prompt and cancels the event (fails when the editor's copy fallback would still open)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const event = dispatch({
			prompt: "Connect this chart to payments",
			block: BLOCK,
			source: "connect-data",
		});
		stop();
		expect(event.defaultPrevented).toBe(true);
		expect(onPrompt).toHaveBeenCalledWith({
			prompt: "Connect this chart to payments",
			block: BLOCK,
			source: "connect-data",
		});
	});

	it("takes a build with the mockup's name and no block (fails when build is refused or read as a block prompt)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const event = dispatch({ prompt: "bikes", source: "build" });
		stop();
		expect(event.defaultPrevented).toBe(true);
		expect(onPrompt).toHaveBeenCalledWith({ prompt: "bikes", source: "build" });
	});

	it("leaves a malformed detail to the editor (fails when it is cancelled or taken)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const unknownSource = dispatch({ prompt: "x", source: "deploy" });
		const blockWithoutPath = dispatch({
			prompt: "x",
			block: { mockup: "bikes", page: "home" },
			source: "custom-zone",
		});
		const buildWithoutName = dispatch({ prompt: "", source: "build" });
		const resolveWithoutName = dispatch({
			prompt: "",
			source: "resolve-comments",
		});
		stop();
		expect(
			[
				unknownSource,
				blockWithoutPath,
				buildWithoutName,
				resolveWithoutName,
			].map((event) => event.defaultPrevented),
		).toEqual([false, false, false, false]);
		expect(onPrompt).not.toHaveBeenCalled();
	});
});

describe("a prompt handed to the panel", () => {
	it("prefills the composer with the block as context and sends nothing (fails on an auto-send)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push({
			kind: "prompt",
			prompt: "Connect this chart to payments",
			block: BLOCK,
		});
		await flushPromises();
		const textarea = panel.find("textarea").element as HTMLTextAreaElement;
		expect(textarea.value).toBe("Connect this chart to payments");
		expect(panel.find(".att.is-block").text()).toContain(
			"ChartCard · grid.revenue",
		);
		expect(sentOfType(harness, "user_message")).toEqual([]);
	});

	it("sends the block with the message, once (fails when the block is lost or sticks to the next message)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push({
			kind: "prompt",
			prompt: "Connect this chart",
			block: BLOCK,
		});
		await flushPromises();
		await panel.find("form.composer").trigger("submit");
		await nextTick();
		const [sent] = sentOfType(harness, "user_message");
		expect(sent.focusBlock).toEqual(BLOCK);
		expect(panel.find(".att.is-block").exists()).toBe(false);
	});
});

describe("building into an existing page", () => {
	it("takes the page to build into from the event (fails when the target is dropped or a bad one is accepted)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const event = dispatch({
			prompt: "bikes",
			source: "build",
			target: { pageRef: "/shop/board" },
		});
		const bad = dispatch({ prompt: "bikes", source: "build", target: {} });
		stop();
		expect(event.defaultPrevented).toBe(true);
		expect(bad.defaultPrevented).toBe(false);
		expect(onPrompt).toHaveBeenCalledOnce();
		expect(onPrompt).toHaveBeenCalledWith({
			prompt: "bikes",
			source: "build",
			target: { pageRef: "/shop/board" },
		});
	});

	it("asks the agent to update that page rather than create one, and to link it (fails when the request reads as a new build)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		harness.session.intents.push({
			kind: "build",
			mockup: "bikes",
			pageRef: "/shop/board",
		});
		await flushPromises();
		const [request] = sentOfType(harness, "user_message");
		expect(request.content).toBe(
			"Build the mockup “bikes” into the existing page /shop/board with the dms-mockup-build skill. Update that page; do not create a new one. End your reply with a Markdown link to that page.",
		);
	});
});

describe("a block sent while a turn runs", () => {
	it("goes with the queued follow-up (fails when queueing drops the block the chip promised)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push({
			kind: "prompt",
			prompt: "Connect this chart",
			block: BLOCK,
		});
		await flushPromises();
		harness.hub.deliver({
			conversationId: CONVERSATION_ID,
			type: "run_progress",
			activity: "thinking",
			elapsedMs: 0,
		});
		await nextTick();
		await panel.find("form.composer").trigger("submit");
		await nextTick();
		const [queued] = sentOfType(harness, "queue_enqueue");
		expect(queued.item).toMatchObject({
			content: "Connect this chart",
			focusBlock: BLOCK,
		});
	});
});

describe("a block handed to one conversation", () => {
	it("leaves the composer when another conversation opens (fails when the block follows into a build)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push({
			kind: "prompt",
			prompt: "Connect this chart",
			block: BLOCK,
		});
		await flushPromises();
		harness.session.intents.push({ kind: "build", mockup: "bikes" });
		await flushPromises();
		expect(panel.find(".att.is-block").exists()).toBe(false);
		const [build] = sentOfType(harness, "user_message");
		expect(build.focusBlock).toBeUndefined();
	});
});

function lastSentConversation(harness: Harness): string {
	const sent = sentOfType(harness, "user_message").at(-1);
	if (sent === undefined || typeof sent.conversationId !== "string")
		throw new Error("no user message sent");
	return sent.conversationId;
}

describe("building a mockup", () => {
	it("sends the build in a new chat and shows its steps in the chat, with no dialog (fails when a build dialog opens or the request is not sent)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push({ kind: "build", mockup: "bikes" });
		await flushPromises();
		const conversationId = lastSentConversation(harness);
		expect(conversationId).not.toBe(CONVERSATION_ID);
		harness.hub.deliver({
			conversationId,
			type: "tool_call_start",
			callId: "c0",
			toolName: "mcp__dms-assistant__builder_create_page",
			args: { name: "rentals", displayName: "Rentals", category: "shop" },
		});
		await nextTick();
		expect(panel.find(".u-modal").exists()).toBe(false);
		expect(panel.find(".chat-view-body .cb-tools").exists()).toBe(true);
	});

	it("asks the agent to end its reply with a link to each page it built (fails when the request drops the links)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		harness.session.intents.push({ kind: "build", mockup: "bikes" });
		await flushPromises();
		const [request] = sentOfType(harness, "user_message");
		expect(request.content).toBe(
			"Build the mockup “bikes” into real pages with the dms-mockup-build skill: create the pages, check the types, compare each page with the mockup and fix the differences, then tell me what remains. End your reply with a Markdown link to each page you built, at the route list_pages gives it.",
		);
	});
});

describe("resolving the comments of a mockup", () => {
	it("takes the mockup and the optional page from the event (fails when the source is refused, the page dropped or read as a block prompt)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const whole = dispatch({ prompt: "bikes", source: "resolve-comments" });
		const onePage = dispatch({
			prompt: "bikes",
			source: "resolve-comments",
			page: "home",
		});
		const blankPage = dispatch({
			prompt: "bikes",
			source: "resolve-comments",
			page: "",
		});
		stop();
		expect([whole, onePage, blankPage].map((e) => e.defaultPrevented)).toEqual([
			true,
			true,
			false,
		]);
		expect(onPrompt.mock.calls).toEqual([
			[{ prompt: "bikes", source: "resolve-comments" }],
			[{ prompt: "bikes", source: "resolve-comments", page: "home" }],
		]);
	});

	it("sends the request in a new chat without a click, naming the mockup and the tools (fails when it only fills the composer)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push({
			kind: "resolve-comments",
			mockup: "bikes",
		});
		await flushPromises();
		const [request] = sentOfType(harness, "user_message");
		expect(request.conversationId).not.toBe(CONVERSATION_ID);
		expect(request.content).toBe(
			[
				"Resolve the open comments of the mockup “bikes”. These steps are all it takes, no skill needed:",
				'1. List the open comments with mockup_annotations (status "open").',
				"2. Each comment carries its block's JSON pointer (path) and node: patch the spec with mockup_patch_spec from those, without reading spec.json. A comment with a page and no path is about that whole page.",
				"3. Resolve each comment you applied with mockup_resolve_annotation. Leave a comment open when you cannot apply it, and ask me your question.",
				"4. Reply briefly: what changed, and what is still open with its question.",
			].join("\n"),
		);
		expect((panel.find("textarea").element as HTMLTextAreaElement).value).toBe(
			"",
		);
	});

	it("limits the request, and the listing, to the page when one is given (fails when the page is dropped)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		harness.session.intents.push({
			kind: "resolve-comments",
			mockup: "bikes",
			page: "home",
		});
		await flushPromises();
		const requests = sentOfType(harness, "user_message");
		expect(requests).toHaveLength(1);
		expect(requests[0].content).toContain(
			"open comments of page home of the mockup “bikes”, and only that page",
		);
		expect(requests[0].content).toContain(
			'mockup_annotations (status "open", page "home")',
		);
	});

	it("carries the mockup's title from a build or a resolve detail, and still takes one without (fails when the title is dropped or required)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const events = [
			dispatch({
				prompt: "shop-admin",
				title: "Shop admin",
				source: "build",
			}),
			dispatch({
				prompt: "shop-admin",
				title: "Shop admin",
				source: "resolve-comments",
				page: "home",
			}),
			dispatch({ prompt: "shop-admin", source: "resolve-comments" }),
		];
		stop();
		expect(events.map((event) => event.defaultPrevented)).toEqual([
			true,
			true,
			true,
		]);
		expect(
			onPrompt.mock.calls.map(([prompt]) => intentOfPrompt(prompt)),
		).toEqual([
			{ kind: "build", mockup: "shop-admin", title: "Shop admin" },
			{
				kind: "resolve-comments",
				mockup: "shop-admin",
				title: "Shop admin",
				page: "home",
			},
			{ kind: "resolve-comments", mockup: "shop-admin" },
		]);
	});

	it("turns each source into its own intent, so only resolving and building send (fails when a source takes another one's intent)", () => {
		expect(
			intentOfPrompt({ prompt: "bikes", source: "resolve-comments" }),
		).toEqual({ kind: "resolve-comments", mockup: "bikes" });
		expect(
			intentOfPrompt({
				prompt: "bikes",
				source: "resolve-comments",
				page: "home",
			}),
		).toEqual({ kind: "resolve-comments", mockup: "bikes", page: "home" });
		expect(intentOfPrompt({ prompt: "bikes", source: "build" })).toEqual({
			kind: "build",
			mockup: "bikes",
		});
		expect(
			intentOfPrompt({ prompt: "Hi", block: BLOCK, source: "custom-zone" }),
		).toEqual({ kind: "prompt", prompt: "Hi", block: BLOCK });
	});
});

describe("the + New mockup card", () => {
	const STARTER = "Draft a mockup of ";

	it("takes the starter sentence and cancels the event, and refuses an empty one (fails when the source is left to the copy fallback)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const event = dispatch({ prompt: STARTER, source: "new-mockup" });
		const empty = dispatch({ prompt: "", source: "new-mockup" });
		stop();
		expect([event, empty].map((e) => e.defaultPrevented)).toEqual([
			true,
			false,
		]);
		expect(onPrompt.mock.calls).toEqual([
			[{ prompt: STARTER, source: "new-mockup" }],
		]);
	});

	it("still takes the connect-data source that dms 0.20.x sends (fails when older dms lose their assistant handoff)", () => {
		const onPrompt = vi.fn();
		const stop = installAssistantPromptListener(onPrompt);
		const event = dispatch({
			prompt: "Connect this chart",
			block: BLOCK,
			source: "connect-data",
		});
		stop();
		expect(event.defaultPrevented).toBe(true);
		expect(intentOfPrompt(onPrompt.mock.calls[0][0])).toEqual({
			kind: "prompt",
			prompt: "Connect this chart",
			block: BLOCK,
		});
	});

	it("starts a conversation with the prompt to put in the composer and not to send (fails when it is read as a block prompt or sent)", () => {
		expect(intentOfPrompt({ prompt: STARTER, source: "new-mockup" })).toEqual({
			kind: "start",
			prompt: STARTER,
		});
	});

	it("opens a new conversation, prefills the composer focused with the caret at the end, and sends nothing (fails on an auto-send, a reused conversation, or a caret at the start)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push(
			intentOfPrompt({ prompt: STARTER, source: "new-mockup" }),
		);
		await flushPromises();
		const textarea = panel.find("textarea").element as HTMLTextAreaElement;
		expect(textarea.value).toBe(STARTER);
		expect(document.activeElement).toBe(textarea);
		expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([
			STARTER.length,
			STARTER.length,
		]);
		expect(localStorage.getItem(STORAGE_CONVERSATION_ID_KEY)).not.toBe(
			CONVERSATION_ID,
		);
		expect(sentOfType(harness, "user_message")).toEqual([]);
	});
});
