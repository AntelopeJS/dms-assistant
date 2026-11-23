/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
	CONVERSATION_ID,
	createHarness,
	deliver,
	openPanel,
	unmountPanel,
} from "./support/panel-harness";

const STORAGE_KEY = "dms-assistant-conversation-id";
const DELETED_NOTICE =
	"This conversation was deleted. Start a new conversation.";

beforeEach(() => {
	localStorage.setItem(STORAGE_KEY, CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
});

describe("a chat panel whose conversation is closed", () => {
	it("starts a new conversation and says why (fails a panel that stays on the closed one)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, {
			type: "conversation_closed",
			conversationId: CONVERSATION_ID,
			message: DELETED_NOTICE,
		});
		await nextTick();
		const current = localStorage.getItem(STORAGE_KEY);
		expect(current).not.toBe(CONVERSATION_ID);
		expect(current).not.toBe("");
		expect(panel.text()).toContain(DELETED_NOTICE);
	});

	it("ignores a notice about another conversation (fails a panel that leaves on any closed id)", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, {
			type: "conversation_closed",
			conversationId: "conv-elsewhere",
			message: DELETED_NOTICE,
		});
		await nextTick();
		expect(localStorage.getItem(STORAGE_KEY)).toBe(CONVERSATION_ID);
		expect(panel.text()).not.toContain(DELETED_NOTICE);
	});
});
