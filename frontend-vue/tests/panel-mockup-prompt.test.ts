// @vitest-environment jsdom
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
	installAssistantPromptListener,
	MOCKUP_ASSISTANT_PROMPT_EVENT,
} from "../app/runtime/assistant-prompt";
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
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
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
		stop();
		expect(
			[unknownSource, blockWithoutPath, buildWithoutName].map(
				(event) => event.defaultPrevented,
			),
		).toEqual([false, false, false]);
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
			toolName: "mcp__dms-ai__builder_create_page",
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
