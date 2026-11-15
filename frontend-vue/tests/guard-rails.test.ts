// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import GuardRails from "../app/components/GuardRails.vue";
import pages from "../i18n/locales/dms-assistant-pages-en-GB.json";
import views from "../i18n/locales/dms-assistant-views-en-GB.json";
import { installApiErrorPresenter } from "./support/api-error-presenter";
import { createTestI18n } from "./support/i18n";
import { DmsCardPanel } from "./support/stand-ins/DmsCardPanel";
import { DmsFieldRow } from "./support/stand-ins/DmsFieldRow";
import { URadioGroup } from "./support/stand-ins/URadioGroup";
import { USwitch } from "./support/stand-ins/USwitch";

const SETTINGS_URL = "/ai/settings";
const NOT_SAVED = views.dms_assistant.views.guard_rails.not_saved;

const SETTINGS = {
	defaultModeClaude: "auto",
	defaultModeCodex: "normal",
	safeMode: true,
	alwaysAskDeletions: true,
	alwaysAskDependencies: true,
	alwaysAskBlockRemoval: true,
	allowLocalSkills: false,
	builderAvailable: true,
};

const authFetch = vi.fn();
const reads: string[] = [];
let answer: Record<string, unknown> | Error;
let add: ReturnType<typeof installApiErrorPresenter>["add"];

const UnavailableStateStub = defineComponent({
	name: "UnavailableState",
	props: { failure: { type: String, default: "" } },
	setup: (props) => () => h("p", { class: "unavailable" }, props.failure),
});

function useApiData(url: string) {
	reads.push(url);
	const data = ref<Record<string, unknown> | null>(null);
	const error = ref<unknown>(null);
	if (answer instanceof Error) error.value = answer;
	else data.value = structuredClone(answer);
	return {
		data,
		error,
		status: ref(answer instanceof Error ? "error" : "success"),
		refresh: vi.fn(),
	};
}

beforeEach(() => {
	reads.length = 0;
	answer = SETTINGS;
	authFetch.mockReset();
	authFetch.mockResolvedValue({});
	({ add } = installApiErrorPresenter({
		"dms_assistant.views.guard_rails.not_saved": NOT_SAVED,
	}));
	const i18n = createTestI18n({
		dms_assistant: { ...pages.dms_assistant, ...views.dms_assistant },
	});
	vi.stubGlobal("useI18n", () => i18n);
	vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
	vi.stubGlobal("useApiData", useApiData);
});

afterEach(() => vi.unstubAllGlobals());

async function mountCard(attrs: Record<string, string> = {}) {
	const card = mount(GuardRails, {
		attrs,
		global: {
			stubs: {
				DmsCardPanel,
				DmsFieldRow,
				URadioGroup,
				USwitch,
				USkeleton: true,
				UnavailableState: UnavailableStateStub,
			},
		},
	});
	await flushPromises();
	return card;
}

function switchOf(card: VueWrapper, label: string) {
	const found = card
		.findAll("[role=switch]")
		.find((control) => control.attributes("aria-label") === label);
	if (!found) throw new Error(`no switch labelled ${label}`);
	return found;
}

function radios(card: VueWrapper, row: number) {
	return card.findAll("[role=radiogroup]")[row].findAll("[role=radio]");
}

function radioLabelled(card: VueWrapper, row: number, label: string) {
	const found = radios(card, row).find(
		(radio) => radio.find("b").text() === label,
	);
	if (!found) throw new Error(`no radio labelled ${label} in group ${row}`);
	return found;
}

function checkedLabel(card: VueWrapper, row: number): string | undefined {
	return radios(card, row)
		.find((radio) => radio.attributes("aria-checked") === "true")
		?.find("b")
		.text();
}

const SAFE_MODE = "Safe mode";
const LOCAL_SKILLS = "Use machine-local skills";

describe("the Guard rails card", () => {
	it.each([
		["Safe mode", SAFE_MODE, { safeMode: false }],
		[
			"Adding or removing dependencies",
			"Adding or removing dependencies",
			{ alwaysAskDependencies: false },
		],
		[
			"Removing or moving Builder blocks",
			"Removing or moving Builder blocks",
			{ alwaysAskBlockRemoval: false },
		],
		["machine-local skills", LOCAL_SKILLS, { allowLocalSkills: true }],
	])(
		"saves the %s switch on its own, with the assistant UI's header",
		async (_name, label, body) => {
			const card = await mountCard();
			await switchOf(card, label).trigger("click");
			expect(authFetch).toHaveBeenCalledExactlyOnceWith(SETTINGS_URL, {
				method: "PUT",
				body: JSON.stringify(body),
				headers: {
					"content-type": "application/json",
					"x-dms-ui-assistant": "1",
				},
			});
		},
	);

	it.each([
		[0, "Plan only", { defaultModeClaude: "plan" }],
		[1, "Plan only", { defaultModeCodex: "plan" }],
		[1, "Accept edits", { defaultModeCodex: "acceptEdits" }],
	])(
		"saves the default mode of row %i, %s, on its own, with the assistant UI's header",
		async (row, label, body) => {
			const card = await mountCard();
			await radioLabelled(card, row, label).trigger("click");
			expect(authFetch).toHaveBeenCalledExactlyOnceWith(SETTINGS_URL, {
				method: "PUT",
				body: JSON.stringify(body),
				headers: expect.objectContaining({ "x-dms-ui-assistant": "1" }),
			});
		},
	);

	it("keeps a switch where the owner put it once the save is accepted", async () => {
		const card = await mountCard();
		const control = switchOf(card, LOCAL_SKILLS);
		await control.trigger("click");
		await flushPromises();
		expect(control.attributes("aria-checked")).toBe("true");
		expect(add).not.toHaveBeenCalled();
	});

	it("puts a switch back to the confirmed value when the save is refused, and says it was not saved", async () => {
		authFetch.mockRejectedValue(
			Object.assign(new Error("Forbidden"), {
				statusCode: 403,
				data: { code: "forbidden", message: "Send the header." },
			}),
		);
		const card = await mountCard();
		const control = switchOf(card, LOCAL_SKILLS);
		await control.trigger("click");
		await flushPromises();
		expect(control.attributes("aria-checked")).toBe("false");
		expect(add).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ title: NOT_SAVED }),
		);
	});

	it("keeps the default mode the owner picked once the save is accepted", async () => {
		const card = await mountCard();
		expect(checkedLabel(card, 0)).toBe("Auto review");
		await radioLabelled(card, 0, "Plan only").trigger("click");
		await flushPromises();
		expect(checkedLabel(card, 0)).toBe("Plan only");
		expect(add).not.toHaveBeenCalled();
	});

	it("puts a default mode back to the confirmed one when the sidecar refuses it, and says it was not saved", async () => {
		authFetch.mockRejectedValue(
			Object.assign(new Error("Bad Request"), {
				statusCode: 400,
				data: { message: "codex has no auto mode" },
			}),
		);
		const card = await mountCard();
		await radioLabelled(card, 0, "Plan only").trigger("click");
		await flushPromises();
		expect(checkedLabel(card, 0)).toBe("Auto review");
		expect(add).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ title: NOT_SAVED }),
		);
	});

	it("shows what each default mode does, Codex's Accept edits in its own words", async () => {
		const card = await mountCard();
		const modes = pages.dms_assistant.settings.mode;
		expect(radioLabelled(card, 0, "Auto review").text()).toContain(
			modes.auto.description,
		);
		expect(radioLabelled(card, 0, "Accept edits").text()).toContain(
			modes.acceptEdits.description,
		);
		expect(radioLabelled(card, 1, "Accept edits").text()).toContain(
			modes.acceptEdits.description_codex,
		);
	});

	it("offers Auto review as a default on Claude Code only", async () => {
		const card = await mountCard();
		const labels = (row: number) =>
			radios(card, row).map((radio) => radio.find("b").text());
		expect(labels(0)).toEqual([
			"Ask first",
			"Auto review",
			"Accept edits",
			"Plan only",
		]);
		expect(labels(1)).toEqual(["Ask first", "Accept edits", "Plan only"]);
	});

	it("shows deletions locked on, and never saves them", async () => {
		const card = await mountCard();
		const locked = switchOf(
			card,
			pages.dms_assistant.settings.always_ask_deletions.locked,
		);
		expect(locked.attributes("aria-checked")).toBe("true");
		expect(locked.attributes("disabled")).toBeDefined();
		await locked.trigger("click");
		expect(authFetch).not.toHaveBeenCalled();
	});

	it("turns Safe mode off the table, saying why, while the Builder is missing", async () => {
		answer = { ...SETTINGS, builderAvailable: false };
		const card = await mountCard();
		const control = switchOf(card, SAFE_MODE);
		expect(control.attributes("disabled")).toBeDefined();
		expect(card.text()).toContain(
			pages.dms_assistant.settings.safe_mode.builder_missing,
		);
		await control.trigger("click");
		expect(authFetch).not.toHaveBeenCalled();
	});

	it("reads and writes `/ai/settings` whatever the page passes it", async () => {
		const card = await mountCard({
			fetchUrl: "/ai/status",
			submitUrl: "/api/anything",
		});
		await switchOf(card, LOCAL_SKILLS).trigger("click");
		expect(reads).toEqual([SETTINGS_URL]);
		expect(authFetch.mock.calls.map(([url]) => url)).toEqual([SETTINGS_URL]);
	});

	it("leaves no translation key on screen", async () => {
		const card = await mountCard();
		expect(card.text()).not.toContain("dms_assistant.");
		expect(card.text()).toContain(views.dms_assistant.views.guard_rails.title);
	});

	it("says the assistant is not running, with no switch to flip, while the first read fails", async () => {
		answer = Object.assign(new Error("Service Unavailable"), {
			statusCode: 503,
		});
		const card = await mountCard();
		expect(card.find(".unavailable").text()).toBe("unavailable");
		expect(card.findAll("[role=switch]")).toEqual([]);
	});
});
