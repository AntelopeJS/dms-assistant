/**
 * The member's saved prompts in the chat: offered by the empty chat, and
 * saved from the composer's draft.
 *
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pages from "../i18n/locales/dms-assistant-pages-en-GB.json";
import panel from "../i18n/locales/dms-assistant-panel-en-GB.json";
import { createTestI18n } from "./support/i18n";
import {
	buttonWithText,
	CONVERSATION_ID,
	createHarness,
	type Harness,
	openPanel,
	sentOfType,
	unmountPanel,
} from "./support/panel-harness";

const PROMPTS_URL = "/ai/prompts";
const SAVE_BUTTON = 'button[aria-label="Save as prompt"]';

const WEEKLY = {
	id: "p-weekly",
	ownerId: "user-1",
	name: "Weekly revenue",
	text: "Summarise last week's revenue per region.",
	createdAtMs: 1,
	updatedAtMs: 1,
};

const AUDIT = {
	...WEEKLY,
	id: "p-audit",
	name: "Audit the orders page",
	text: "List what the orders page shows and what it lacks.",
};

/** The panel's and the module's English strings together, as the dashboard loads them. */
function dashboardI18n() {
	return createTestI18n({
		dms_assistant: { ...panel.dms_assistant, ...pages.dms_assistant },
	});
}

function listAnswers(harness: Harness, prompts: object[]): void {
	vi.mocked(harness.api.get).mockResolvedValue({
		results: prompts,
		total: prompts.length,
	});
}

beforeEach(() => {
	localStorage.setItem("dms-assistant-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
});

describe("saved prompts in the empty chat", () => {
	it("reads the member's prompts from /ai/prompts, lists them by name under the starters, and puts one in the composer unsent on click (fails a panel that sends it at once)", async () => {
		const harness = createHarness();
		listAnswers(harness, [WEEKLY, AUDIT]);
		const panelView = await openPanel(harness);
		await flushPromises();
		expect(harness.api.get).toHaveBeenCalledWith(PROMPTS_URL);
		const saved = panelView.find(".cb-saved");
		expect(saved.text()).toContain("Saved prompts");
		expect(
			saved.findAll(".cb-suggest__text").map((item) => item.text()),
		).toEqual(["Audit the orders page", "Weekly revenue"]);
		await buttonWithText(saved, "Weekly revenue").trigger("click");
		expect(panelView.find<HTMLTextAreaElement>("textarea").element.value).toBe(
			WEEKLY.text,
		);
		expect(sentOfType(harness, "user_message")).toEqual([]);
	});

	it("opens the Prompts page from Manage", async () => {
		const harness = createHarness();
		listAnswers(harness, [WEEKLY]);
		const panelView = await openPanel(harness);
		await flushPromises();
		await buttonWithText(panelView.find(".cb-saved"), "Manage").trigger(
			"click",
		);
		expect(harness.navigate).toHaveBeenCalledWith("/modules/ai/prompts");
	});

	it("shows no saved prompts section while the member has none, or the read fails", async () => {
		const harness = createHarness();
		listAnswers(harness, []);
		const panelView = await openPanel(harness);
		await flushPromises();
		expect(panelView.find(".cb-saved").exists()).toBe(false);
		unmountPanel();
		const failing = createHarness();
		vi.mocked(failing.api.get).mockRejectedValue(new Error("down"));
		const failed = await openPanel(failing);
		await flushPromises();
		expect(failed.find(".cb-saved").exists()).toBe(false);
		expect(failed.find(".cb-empty h3").exists()).toBe(true);
	});
});

describe("saving the draft as a prompt", () => {
	it("is off while the composer is empty, and names the draft in a dialog once there is one", async () => {
		const harness = createHarness();
		listAnswers(harness, []);
		const panelView = await openPanel(harness);
		expect(panelView.find(SAVE_BUTTON).attributes("disabled")).toBeDefined();
		await panelView.find("textarea").setValue(WEEKLY.text);
		expect(panelView.find(SAVE_BUTTON).attributes("disabled")).toBeUndefined();
		await panelView.find(SAVE_BUTTON).trigger("click");
		const dialog = panelView.find(".u-modal");
		expect(dialog.text()).toContain("Save as prompt");
		expect(dialog.text()).toContain(WEEKLY.text);
	});

	it("posts the name and the draft to /ai/prompts, keeps the draft, lists the prompt and says it was saved (fails a save that clears the composer)", async () => {
		const harness = createHarness();
		listAnswers(harness, []);
		vi.mocked(harness.api.post).mockResolvedValue(WEEKLY);
		const panelView = await openPanel(harness);
		await panelView.find("textarea").setValue(WEEKLY.text);
		await panelView.find(SAVE_BUTTON).trigger("click");
		const dialog = panelView.find(".u-modal");
		await dialog.find("input").setValue("Weekly revenue");
		await buttonWithText(dialog, "Save").trigger("click");
		await flushPromises();
		expect(harness.api.post).toHaveBeenCalledWith(PROMPTS_URL, {
			name: "Weekly revenue",
			text: WEEKLY.text,
		});
		expect(panelView.find(".u-modal").exists()).toBe(false);
		expect(panelView.find(".cb-toast").text()).toContain(
			"Saved “Weekly revenue”",
		);
		expect(panelView.find<HTMLTextAreaElement>("textarea").element.value).toBe(
			WEEKLY.text,
		);
		expect(panelView.find(".cb-saved").text()).toContain("Weekly revenue");
		expect(sentOfType(harness, "user_message")).toEqual([]);
	});

	it("keeps the dialog open with the module's reason, in the user's language, when the name is taken", async () => {
		const harness = createHarness();
		listAnswers(harness, [WEEKLY]);
		vi.mocked(harness.api.post).mockRejectedValue(
			Object.assign(new Error("Conflict"), {
				statusCode: 409,
				data: {
					code: "duplicate_name",
					field: "name",
					message: "$dms_assistant.errors.prompt_name_taken",
					params: { name: "Weekly revenue" },
				},
			}),
		);
		const panelView = await openPanel(harness, dashboardI18n());
		await panelView.find("textarea").setValue("again");
		await panelView.find(SAVE_BUTTON).trigger("click");
		const dialog = panelView.find(".u-modal");
		await dialog.find("input").setValue("Weekly revenue");
		await buttonWithText(dialog, "Save").trigger("click");
		await flushPromises();
		expect(panelView.find(".u-modal").exists()).toBe(true);
		expect(panelView.find(".u-modal [role=alert]").text()).toBe(
			"You already have a prompt named “Weekly revenue”.",
		);
		expect(panelView.find(".cb-toast").exists()).toBe(false);
	});
});
