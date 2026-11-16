// @vitest-environment jsdom
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
	installAssistantPromptListener,
	MOCKUP_ASSISTANT_PROMPT_EVENT,
} from "../app/runtime/assistant-prompt";
import { intentOfPrompt } from "../app/runtime/panel-intents";
import {
	buttonWithText,
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

	it("asks the agent to update that page rather than create one (fails when the request reads as a new build)", async () => {
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
			"Build mockup bikes into the existing page /shop/board with the dms-mockup-build skill. Update that page; do not create a new one.",
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
	it("starts the build in a new chat and follows it in the dialog until sent to the background (fails when the build is not sent or the dialog cannot be left)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.intents.push({ kind: "build", mockup: "bikes" });
		await flushPromises();
		const conversationId = lastSentConversation(harness);
		expect(conversationId).not.toBe(CONVERSATION_ID);
		expect(sentOfType(harness, "user_message")[0].content).toContain("“bikes”");
		harness.hub.deliver({
			conversationId,
			type: "tool_call_start",
			callId: "c0",
			toolName: "mcp__dms-assistant__builder_create_page",
			args: { name: "rentals", displayName: "Rentals", category: "shop" },
		});
		await nextTick();
		const dialog = panel.find(".u-modal");
		expect(dialog.text()).toContain("Building “bikes”");
		expect(dialog.findAll(".cb-build__step")).toHaveLength(1);
		await buttonWithText(dialog, "Run in background").trigger("click");
		expect(panel.find(".u-modal").exists()).toBe(false);
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
			"Use the dms-mockup skill to resolve the open comments of mockup “bikes”. List them with mockup_annotations, apply each one to the spec with mockup_patch_spec, then resolve it with mockup_resolve_annotation. A comment is pinned to a block or to a whole page: treat a comment pinned to a page only as a comment on that whole page. Leave a comment open when you cannot apply it, and ask me your question. Finish by telling me what changed and what is still open, with its question.",
		);
		expect((panel.find("textarea").element as HTMLTextAreaElement).value).toBe(
			"",
		);
	});

	it("limits the request to the page when one is given (fails when the page is dropped)", async () => {
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
			"open comments of page home of mockup “bikes”, and only that page",
		);
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
