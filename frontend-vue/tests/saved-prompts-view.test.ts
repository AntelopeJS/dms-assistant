/**
 * The Prompts page: the member's saved prompts, with New, Edit, Delete and
 * Run. Reads go through the page's `useApiData`, writes through `$authFetch`.
 *
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import {
	type DOMWrapper,
	flushPromises,
	mount,
	type VueWrapper,
} from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import SavedPrompts from "../app/components/SavedPrompts.vue";
import type { SavedPrompt } from "../app/views/types";
import pages from "../i18n/locales/dms-assistant-pages-en-GB.json";
import views from "../i18n/locales/dms-assistant-views-en-GB.json";
import { installApiErrorPresenter } from "./support/api-error-presenter";
import { createTestI18n } from "./support/i18n";
import { createHarness, providedSession } from "./support/panel-harness";
import { DmsCardPanel } from "./support/stand-ins/DmsCardPanel";
import { DmsEmptyState } from "./support/stand-ins/DmsEmptyState";
import { UButton } from "./support/stand-ins/UButton";
import { UFormField } from "./support/stand-ins/UFormField";
import { UInput } from "./support/stand-ins/UInput";
import { UModal } from "./support/stand-ins/UModal";
import { UTextarea } from "./support/stand-ins/UTextarea";

const PROMPTS_URL = "/ai/prompts";
const JSON_HEADERS = { "content-type": "application/json" };
const NAME_TAKEN = "You already have a prompt named “Weekly revenue”.";

const WEEKLY: SavedPrompt = {
	id: "p-weekly",
	ownerId: "user-1",
	name: "Weekly revenue",
	text: "Summarise last week's revenue per region.",
	createdAtMs: Date.UTC(2026, 10, 20, 9),
	updatedAtMs: Date.UTC(2026, 10, 27, 9),
};

const AUDIT: SavedPrompt = {
	...WEEKLY,
	id: "p-audit",
	name: "Audit the orders page",
	text: "List what the orders page shows and what it lacks.",
};

type ListAnswer = { results: SavedPrompt[]; total: number } | Error;

/** A write of the page, as `$authFetch` is called for it. */
interface WriteRequest {
	method: string;
	body?: string;
	headers?: Record<string, string>;
}

/** What a write answers: the saved prompt, or the nothing a deletion reads. */
type WriteAnswer = SavedPrompt | Record<string, never>;

let answer: ListAnswer;
const reads: string[] = [];
const authFetch =
	vi.fn<(url: string, request?: WriteRequest) => Promise<WriteAnswer>>();

const UnavailableStateStub = defineComponent({
	name: "UnavailableState",
	props: { failure: { type: String, default: "" } },
	setup: (props) => () => h("p", { class: "unavailable" }, props.failure),
});

/** `useApiData` as the page runs it: the read answers at once, and `refresh` reads again. */
function useApiData(url: string) {
	const data = ref<Exclude<ListAnswer, Error> | null>(null);
	const error = ref<unknown>(null);
	const status = ref<"success" | "error">("success");
	const read = () => {
		reads.push(url);
		if (answer instanceof Error) {
			error.value = answer;
			status.value = "error";
		} else {
			data.value = structuredClone(answer);
			error.value = null;
			status.value = "success";
		}
	};
	read();
	return { data, error, status, refresh: vi.fn(async () => read()) };
}

function list(prompts: SavedPrompt[]): ListAnswer {
	return { results: prompts, total: prompts.length };
}

beforeEach(() => {
	reads.length = 0;
	answer = list([WEEKLY, AUDIT]);
	authFetch.mockReset();
	authFetch.mockResolvedValue({});
	installApiErrorPresenter({
		"dms_assistant.views.prompts.not_saved":
			views.dms_assistant.views.prompts.not_saved,
		"dms_assistant.errors.prompt_name_taken": NAME_TAKEN,
	});
	const i18n = createTestI18n({
		dms_assistant: { ...pages.dms_assistant, ...views.dms_assistant },
	});
	vi.stubGlobal("useI18n", () => i18n);
	vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
	vi.stubGlobal("useApiData", useApiData);
	vi.stubGlobal("useRegionalFormat", () => ({
		dateTimeFormat: (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }),
	}));
});

afterEach(() => vi.unstubAllGlobals());

async function mountPage(withSession = false) {
	const session = withSession ? createHarness().session : null;
	const page = mount(SavedPrompts, {
		global: {
			provide: providedSession(session),
			stubs: {
				DmsCardPanel,
				DmsEmptyState,
				UButton,
				UFormField,
				UInput,
				UModal,
				UTextarea,
				USkeleton: true,
				UIcon: true,
				UnavailableState: UnavailableStateStub,
			},
		},
	});
	await flushPromises();
	return { page, session };
}

function buttonLabelled(root: VueWrapper | DOMWrapper<Element>, label: string) {
	const found = root
		.findAll("button")
		.find(
			(button) =>
				button.text() === label || button.attributes("aria-label") === label,
		);
	if (!found) throw new Error(`no button ${label}`);
	return found;
}

function rowOf(page: VueWrapper, id: string) {
	return page.find(`[data-prompt-id="${id}"]`);
}

describe("the list", () => {
	it("reads /ai/prompts with the page and lists each prompt with its text and when it changed (fails a page that reads with $authFetch)", async () => {
		const { page } = await mountPage();
		expect(reads).toEqual([PROMPTS_URL]);
		expect(authFetch).not.toHaveBeenCalled();
		expect(rowOf(page, "p-weekly").text()).toContain("Weekly revenue");
		expect(rowOf(page, "p-weekly").text()).toContain(WEEKLY.text);
		expect(rowOf(page, "p-weekly").text()).toContain("Updated");
		expect(page.text()).toContain("2 prompts");
	});

	it("filters the list on the search, over names and texts", async () => {
		const { page } = await mountPage();
		await page.find("input").setValue("orders");
		expect(rowOf(page, "p-audit").exists()).toBe(true);
		expect(rowOf(page, "p-weekly").exists()).toBe(false);
		await page.find("input").setValue("nothing here");
		expect(page.text()).toContain("No prompt matches");
	});

	it("says there is no prompt yet and offers New prompt, and says when the assistant is not running", async () => {
		answer = list([]);
		const { page } = await mountPage();
		expect(page.text()).toContain("No saved prompts yet");
		answer = Object.assign(new Error("Service Unavailable"), {
			statusCode: 503,
		});
		const { page: down } = await mountPage();
		expect(down.find(".unavailable").text()).toBe("unavailable");
	});

	it("offers Run only once the assistant runs in the tab, and Run opens a new conversation with the prompt sent (fails a Run that only prefills the composer)", async () => {
		const { page: without } = await mountPage();
		expect(without.findAll("button").some((b) => b.text() === "Run")).toBe(
			false,
		);
		const { page, session } = await mountPage(true);
		await buttonLabelled(rowOf(page, "p-weekly"), "Run").trigger("click");
		expect(session?.intents.pending.value).toEqual({
			kind: "start",
			prompt: WEEKLY.text,
			send: true,
		});
	});
});

describe("the editor", () => {
	it("saves a new prompt with POST and reads the list again", async () => {
		const { page } = await mountPage();
		await buttonLabelled(page, "New prompt").trigger("click");
		const dialog = page.find(".u-modal");
		expect(dialog.find("h2").text()).toBe("New prompt");
		await dialog.find("input").setValue("  Monthly churn ");
		await dialog.find("textarea").setValue("Explain churn by plan.");
		await buttonLabelled(dialog, "Save").trigger("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledExactlyOnceWith(PROMPTS_URL, {
			method: "POST",
			body: JSON.stringify({
				name: "  Monthly churn ",
				text: "Explain churn by plan.",
			}),
			headers: JSON_HEADERS,
		});
		expect(reads).toEqual([PROMPTS_URL, PROMPTS_URL]);
		expect(page.find(".u-modal").exists()).toBe(false);
	});

	it("edits a prompt with PUT on its id, the fields prefilled", async () => {
		const { page } = await mountPage();
		await buttonLabelled(rowOf(page, "p-audit"), "Edit").trigger("click");
		const dialog = page.find(".u-modal");
		expect(dialog.find("h2").text()).toBe("Edit prompt");
		expect(dialog.find<HTMLInputElement>("input").element.value).toBe(
			AUDIT.name,
		);
		await dialog.find("textarea").setValue("Audit the orders page in depth.");
		await buttonLabelled(dialog, "Save").trigger("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledExactlyOnceWith(
			`${PROMPTS_URL}/p-audit`,
			{
				method: "PUT",
				body: JSON.stringify({
					name: AUDIT.name,
					text: "Audit the orders page in depth.",
				}),
				headers: JSON_HEADERS,
			},
		);
	});

	it("keeps the editor open with the module's reason under the name when the name is taken", async () => {
		authFetch.mockRejectedValue(
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
		const { page } = await mountPage();
		await buttonLabelled(page, "New prompt").trigger("click");
		const dialog = page.find(".u-modal");
		await dialog.find("input").setValue("Weekly revenue");
		await dialog.find("textarea").setValue("again");
		await buttonLabelled(dialog, "Save").trigger("click");
		await flushPromises();
		expect(page.find(".u-modal").exists()).toBe(true);
		expect(page.find(".u-modal [role=alert]").text()).toBe(NAME_TAKEN);
		expect(reads).toEqual([PROMPTS_URL]);
	});

	it("saves nothing while the name or the prompt is blank", async () => {
		const { page } = await mountPage();
		await buttonLabelled(page, "New prompt").trigger("click");
		const dialog = page.find(".u-modal");
		await dialog.find("input").setValue("Only a name");
		expect(buttonLabelled(dialog, "Save").attributes("disabled")).toBeDefined();
		await buttonLabelled(dialog, "Save").trigger("click");
		expect(authFetch).not.toHaveBeenCalled();
	});
});

describe("deleting a prompt", () => {
	it("asks first, naming the prompt, then deletes it with DELETE and reads the list again", async () => {
		const { page } = await mountPage();
		await buttonLabelled(rowOf(page, "p-weekly"), "Delete").trigger("click");
		expect(authFetch).not.toHaveBeenCalled();
		const dialog = page.find(".u-modal");
		expect(dialog.find("h2").text()).toBe("Delete “Weekly revenue”?");
		await buttonLabelled(dialog, "Delete").trigger("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledExactlyOnceWith(
			`${PROMPTS_URL}/p-weekly`,
			{ method: "DELETE" },
		);
		expect(reads).toEqual([PROMPTS_URL, PROMPTS_URL]);
		expect(page.find(".u-modal").exists()).toBe(false);
	});
});
