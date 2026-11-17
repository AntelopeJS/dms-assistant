// @vitest-environment jsdom
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installAssistantPromptListener,
	MOCKUP_ASSISTANT_PROMPT_EVENT,
	MOCKUP_ASSISTANT_RUN_EVENT,
	MOCKUP_ASSISTANT_RUN_QUERY_EVENT,
	type MockupAssistantRun,
} from "../app/runtime/assistant-prompt";
import { createChatTransport } from "../app/runtime/chat-transport";
import {
	createMockupRuns,
	installMockupRunAnswers,
	routePrompt,
} from "../app/runtime/mockup-runs";
import { STORAGE_CONVERSATION_ID_KEY } from "../app/chat/constants/conversation";
import {
	CONVERSATION_ID,
	createHarness,
	type Harness,
	openPanel,
	sentOfType,
	unmountPanel,
} from "./support/panel-harness";

let events: MockupAssistantRun[] = [];
let stops: Array<() => void> = [];

function onRunEvent(event: Event): void {
	if (event instanceof CustomEvent) events.push(event.detail);
}

beforeEach(() => {
	localStorage.setItem(STORAGE_CONVERSATION_ID_KEY, CONVERSATION_ID);
	events = [];
	window.addEventListener(MOCKUP_ASSISTANT_RUN_EVENT, onRunEvent);
});

afterEach(() => {
	window.removeEventListener(MOCKUP_ASSISTANT_RUN_EVENT, onRunEvent);
	stops.forEach((stop) => stop());
	stops = [];
	unmountPanel();
	localStorage.clear();
	sessionStorage.clear();
});

/** The dashboard's handling of a prompt, as the plugin installs it. */
function handOverPrompts(harness: Harness): void {
	stops.push(
		installAssistantPromptListener((prompt) =>
			harness.session.intents.push(routePrompt(prompt, harness.session.runs)),
		),
	);
}

function click(source: "build" | "resolve-comments", mockup = "bikes"): Event {
	const event = new CustomEvent(MOCKUP_ASSISTANT_PROMPT_EVENT, {
		detail: { prompt: mockup, source },
		cancelable: true,
	});
	window.dispatchEvent(event);
	return event;
}

function startedConversation(harness: Harness): string {
	const sent = sentOfType(harness, "user_message").at(-1);
	if (sent === undefined || typeof sent.conversationId !== "string")
		throw new Error("no user message sent");
	return sent.conversationId;
}

function activeConversation(): string | null {
	return localStorage.getItem(STORAGE_CONVERSATION_ID_KEY);
}

describe("a click on Resolve or Build during a run", () => {
	it("opens the running conversation and starts no second run (fails when a second click starts a new conversation)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("resolve-comments");
		await flushPromises();
		const running = startedConversation(harness);
		harness.session.intents.push({ kind: "open", conversationId: "other" });
		await flushPromises();
		expect(activeConversation()).toBe("other");

		const second = click("resolve-comments");
		await flushPromises();

		expect(second.defaultPrevented).toBe(true);
		expect(sentOfType(harness, "user_message")).toHaveLength(1);
		expect(activeConversation()).toBe(running);
		expect(events).toEqual([
			{ mockup: "bikes", source: "resolve-comments", running: true },
		]);
	});

	it("starts a new conversation once the run finished (fails when a finished run still captures the click)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("build");
		await flushPromises();
		const first = startedConversation(harness);
		harness.hub.deliver({ type: "run_done", conversationId: first });
		await flushPromises();

		click("build");
		await flushPromises();

		expect(sentOfType(harness, "user_message")).toHaveLength(2);
		expect(startedConversation(harness)).not.toBe(first);
	});

	it("keeps another mockup and the other source apart (fails when runs are keyed by mockup or source alone)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("build", "bikes");
		await flushPromises();
		click("resolve-comments", "bikes");
		await flushPromises();
		click("build", "shop");
		await flushPromises();
		expect(sentOfType(harness, "user_message")).toHaveLength(3);
	});
});

describe("the run events", () => {
	it("tell the DMS when a run starts and when it finishes (fails when either event is missing)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("build");
		await flushPromises();
		expect(events).toEqual([
			{ mockup: "bikes", source: "build", running: true },
		]);
		harness.hub.deliver({
			type: "run_done",
			conversationId: startedConversation(harness),
		});
		expect(events.at(-1)).toEqual({
			mockup: "bikes",
			source: "build",
			running: false,
		});
		expect(events).toHaveLength(2);
	});

	it("tell the DMS when a run errors (fails when an error leaves the run going)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("resolve-comments");
		await flushPromises();
		harness.hub.deliver({
			type: "run_error",
			conversationId: startedConversation(harness),
			error: "boom",
		});
		expect(events.at(-1)).toEqual({
			mockup: "bikes",
			source: "resolve-comments",
			running: false,
		});
	});

	it("tell the DMS when the conversation closes under the run (fails when a closed conversation leaves the run going)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("build");
		await flushPromises();
		harness.hub.deliver({
			type: "conversation_closed",
			conversationId: startedConversation(harness),
		});
		expect(events.at(-1)).toMatchObject({ running: false });
	});

	it("tell the DMS when the run is stopped and no run_done comes, from the conversation list (fails when a stopped run stays going)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("build");
		await flushPromises();
		const id = startedConversation(harness);
		const list = (isRunning: boolean) =>
			harness.hub.deliver({
				type: "conversation_list",
				conversations: [{ id, isRunning }],
			});
		list(false);
		expect(events).toHaveLength(1);
		list(true);
		list(false);
		expect(events.at(-1)).toEqual({
			mockup: "bikes",
			source: "build",
			running: false,
		});
	});

	it("tell the DMS when the running conversation is deleted (fails when a deleted conversation leaves the run going)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		click("build");
		await flushPromises();
		harness.hub.deliver({
			type: "run_progress",
			conversationId: startedConversation(harness),
			activity: "thinking",
			elapsedMs: 0,
		});
		harness.hub.deliver({ type: "conversation_list", conversations: [] });
		expect(events.at(-1)).toMatchObject({ running: false });
	});
});

describe("the DMS asking for the current state", () => {
	it("is answered with running true for each run going on (fails when the query is ignored or a finished run is told)", async () => {
		const harness = createHarness();
		await openPanel(harness);
		handOverPrompts(harness);
		stops.push(installMockupRunAnswers(harness.session.runs));
		click("build", "bikes");
		await flushPromises();
		click("resolve-comments", "shop");
		await flushPromises();
		harness.hub.deliver({
			type: "run_done",
			conversationId: startedConversation(harness),
		});
		events = [];

		window.dispatchEvent(new CustomEvent(MOCKUP_ASSISTANT_RUN_QUERY_EVENT));

		expect(events).toEqual([
			{ mockup: "bikes", source: "build", running: true },
		]);
	});

	it("is answered after a page reload from the runs the tab kept (fails when the runs live in memory only)", () => {
		const hub = createChatTransport({
			send: () => true,
			reconnect: () => undefined,
			getStatus: () => "connected",
		});
		const emit = vi.fn();
		const options = {
			chat: hub.transport,
			storage: () => window.sessionStorage,
			emit,
		};
		const before = createMockupRuns(options);
		before.begin({ mockup: "bikes", source: "build" }, "conv-1");
		before.stop();
		emit.mockClear();

		const after = createMockupRuns(options);
		after.announce();

		expect(emit).toHaveBeenCalledWith({
			mockup: "bikes",
			source: "build",
			running: true,
		});
		hub.deliver({
			type: "conversation_list",
			conversations: [{ id: "conv-1", isRunning: false }],
		});
		expect(emit).toHaveBeenLastCalledWith({
			mockup: "bikes",
			source: "build",
			running: false,
		});
		after.stop();
	});

	it("tells the runs kept by the tab once the listener is installed (fails when a viewer that mounted first never hears)", () => {
		const hub = createChatTransport({
			send: () => true,
			reconnect: () => undefined,
			getStatus: () => "connected",
		});
		sessionStorage.setItem(
			"dms-assistant-mockup-runs",
			JSON.stringify([
				{ mockup: "bikes", source: "build", conversationId: "conv-1" },
			]),
		);
		const runs = createMockupRuns({
			chat: hub.transport,
			storage: () => window.sessionStorage,
			emit: (run) => events.push(run),
		});
		stops.push(runs.stop, installMockupRunAnswers(runs));
		expect(events).toEqual([
			{ mockup: "bikes", source: "build", running: true },
		]);
	});
});
