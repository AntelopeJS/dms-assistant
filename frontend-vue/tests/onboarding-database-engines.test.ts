// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import OnboardingDatabase from "../app/views/onboarding/OnboardingDatabase.vue";
import views from "../i18n/locales/dms-assistant-views-en-GB.json";
import {
	createOnboardingHarness,
	ONBOARDING_STUBS,
} from "./support/onboarding";

const builder = vi.hoisted(() => ({
	projectModules: vi.fn<() => Promise<unknown>>(),
	checkConnection: vi.fn<(engine: string, url: string) => Promise<unknown>>(),
}));

vi.mock("../builder/app/runtime/i18n", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	t: (key: string, params?: Record<string, unknown>) =>
		params === undefined ? key : `${key} ${JSON.stringify(params)}`,
}));

vi.mock("../builder/app/runtime/api", () => ({
	useBuilderApi: () => ({
		projectModules: builder.projectModules,
		checkConnection: builder.checkConnection,
		failure: (error: unknown) => ({ detail: String(error) }),
	}),
}));

const WITHOUT_MYSQL_DRIVER = {
	modules: ["dms", "mongodb"],
	self: "dms",
	databasePins: [],
	interfaceDatabase: "0.4.0",
	drivers: {
		postgres: { package: "@antelopejs/postgres", version: ">=0.4.0 <0.5.0" },
		mongodb: { package: "@antelopejs/mongodb", version: ">=1.8.0 <1.9.0" },
		rethinkdb: {
			package: "@antelopejs/rethinkdb",
			version: ">=1.10.0 <1.11.0",
		},
	},
};

let wrapper: VueWrapper | undefined;

async function openPicker(): Promise<VueWrapper> {
	const harness = createOnboardingHarness();
	wrapper = mount(OnboardingDatabase, {
		global: { provide: harness.provide, stubs: ONBOARDING_STUBS },
	});
	await flushPromises();
	return wrapper;
}

const ENGINE_LABELS = ["PostgreSQL", "MongoDB", "RethinkDB", "MySQL / MariaDB"];

function button(picker: VueWrapper, label: string): HTMLButtonElement {
	const found = picker
		.findAll<HTMLButtonElement>("button")
		.find((candidate) => candidate.text() === label);
	if (found === undefined) throw new Error(`no button reads ${label}`);
	return found.element;
}

function connectButton(picker: VueWrapper): HTMLButtonElement {
	return button(picker, views.dms_assistant.views.onboarding.database.connect);
}

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	builder.projectModules.mockReset();
	builder.checkConnection.mockReset();
});

describe("the engine picker", () => {
	/** Fails on a picker that offers an engine the project cannot install a driver for, turns off one it can, or hides why. */
	it("turns off an engine the project has no driver for, and says why", async () => {
		builder.projectModules.mockResolvedValue(WITHOUT_MYSQL_DRIVER);
		const picker = await openPicker();
		expect(
			picker.findAll('[role="radio"]').map((option) => option.text()),
		).toEqual(ENGINE_LABELS);
		expect(button(picker, "MySQL / MariaDB").disabled).toBe(true);
		for (const label of ["PostgreSQL", "MongoDB", "RethinkDB"]) {
			expect(button(picker, label).disabled).toBe(false);
		}
		expect(
			picker.findAll("[data-unavailable]").map((line) => line.text()),
		).toEqual([
			'database.engines.unavailable {"engine":"MySQL / MariaDB","version":"0.4.0"}',
		]);
	});

	/** Fails on a popup that lets a URL of an engine without a driver reach the live check. */
	it("keeps Connect off for a URL of an engine without a driver", async () => {
		builder.projectModules.mockResolvedValue(WITHOUT_MYSQL_DRIVER);
		const picker = await openPicker();
		await picker.find("input").setValue("mysql://app@db.example.com/shop");
		expect(button(picker, "MySQL / MariaDB").getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(connectButton(picker).disabled).toBe(true);
		await picker.find("input").setValue("postgres://app@db.example.com/shop");
		expect(connectButton(picker).disabled).toBe(false);
	});

	/** Fails on an Enter in the URL field that runs the live check of a URL whose engine has no driver, which the turned-off Connect button never runs. */
	it("ignores Enter on a URL of an engine without a driver, as Connect does", async () => {
		builder.projectModules.mockResolvedValue(WITHOUT_MYSQL_DRIVER);
		builder.checkConnection.mockResolvedValue({
			reachable: false,
			canRead: false,
			canWrite: false,
			reason: "Nothing is listening at this host and port.",
		});
		const picker = await openPicker();
		const input = picker.find("input");
		await input.setValue("mysql://app@db.example.com/shop");
		await input.trigger("keydown", { key: "Enter" });
		await flushPromises();
		expect(builder.checkConnection).not.toHaveBeenCalled();
		await input.setValue("postgres://app@db.example.com/shop");
		await input.trigger("keydown", { key: "Enter" });
		await flushPromises();
		expect(builder.checkConnection).toHaveBeenCalledWith(
			"postgres",
			"postgres://app@db.example.com/shop",
		);
	});

	/** Fails on a picker that turns every engine off when the project cannot be read. */
	it("offers every engine while it cannot read the project", async () => {
		builder.projectModules.mockRejectedValue(new Error("refused"));
		const picker = await openPicker();
		for (const label of ENGINE_LABELS) {
			expect(button(picker, label).disabled).toBe(false);
		}
		expect(picker.findAll("[data-unavailable]")).toHaveLength(0);
	});
});
