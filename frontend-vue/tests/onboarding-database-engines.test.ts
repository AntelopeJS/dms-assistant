/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import OnboardingDatabase from "../app/views/onboarding/OnboardingDatabase.vue";
import views from "../i18n/locales/dms-assistant-views-en-GB.json";
import { builderServer } from "./support/builder-server";
import {
	createOnboardingHarness,
	ONBOARDING_STUBS,
} from "./support/onboarding";

const builder = builderServer();

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

beforeEach(builder.serve);

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	builder.reset();
});

describe("the engine picker", () => {
	it("turns off an engine the project has no driver for, and says why (fails on a picker that offers an engine the project cannot install a driver for, turns off one it can, or hides why)", async () => {
		builder.project.mockResolvedValue(WITHOUT_MYSQL_DRIVER);
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

	it("keeps Connect off for a URL of an engine without a driver (fails on a popup that lets a URL of an engine without a driver reach the live check)", async () => {
		builder.project.mockResolvedValue(WITHOUT_MYSQL_DRIVER);
		const picker = await openPicker();
		await picker.find("input").setValue("mysql://app@db.example.com/shop");
		expect(button(picker, "MySQL / MariaDB").getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(connectButton(picker).disabled).toBe(true);
		await picker.find("input").setValue("postgres://app@db.example.com/shop");
		expect(connectButton(picker).disabled).toBe(false);
	});

	it("ignores Enter on a URL of an engine without a driver, as Connect does (fails on an Enter in the URL field that runs the live check of a URL whose engine has no driver, which the turned-off Connect button never runs)", async () => {
		builder.project.mockResolvedValue(WITHOUT_MYSQL_DRIVER);
		builder.check.mockResolvedValue({
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
		expect(builder.check).not.toHaveBeenCalled();
		await input.setValue("postgres://app@db.example.com/shop");
		await input.trigger("keydown", { key: "Enter" });
		await flushPromises();
		expect(builder.check).toHaveBeenCalledWith(
			"postgres",
			"postgres://app@db.example.com/shop",
		);
	});

	it("offers every engine while it cannot read the project (fails on a picker that turns every engine off when the project cannot be read)", async () => {
		builder.project.mockRejectedValue(new Error("refused"));
		const picker = await openPicker();
		for (const label of ENGINE_LABELS) {
			expect(button(picker, label).disabled).toBe(false);
		}
		expect(picker.findAll("[data-unavailable]")).toHaveLength(0);
	});
});
