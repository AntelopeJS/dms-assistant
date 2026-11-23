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

const PROJECT = {
	modules: ["dms", "mongodb"],
	self: "dms",
	databasePins: [],
	drivers: {
		postgres: { package: "@antelopejs/postgres", version: ">=0.4.2 <0.5.0" },
		mysql: { package: "@antelopejs/mysql", version: ">=0.2.4 <0.3.0" },
		mongodb: { package: "@antelopejs/mongodb", version: "~1.8.5" },
		rethinkdb: { package: "@antelopejs/rethinkdb", version: "~1.10.4" },
	},
};

const REASON = "Install @antelopejs/postgres to connect a PostgreSQL database.";
const COMMAND =
	'pnpm add --save-prefix=~ "@antelopejs/postgres@>=0.4.2 <0.5.0"';
const MISSING_DRIVER = {
	reachable: false,
	canRead: false,
	canWrite: false,
	reason: REASON,
	install: { package: "@antelopejs/postgres", command: COMMAND },
};
const TEXT = views.dms_assistant.views.onboarding.database;

let wrapper: VueWrapper | undefined;

async function checked(): Promise<VueWrapper> {
	builder.project.mockResolvedValue(PROJECT);
	const harness = createOnboardingHarness();
	wrapper = mount(OnboardingDatabase, {
		global: { provide: harness.provide, stubs: ONBOARDING_STUBS },
	});
	await flushPromises();
	await wrapper.find("input").setValue("postgres://app@db.example.com/shop");
	await wrapper.find("input").trigger("keydown", { key: "Enter" });
	await flushPromises();
	return wrapper;
}

function connectButton(picker: VueWrapper): HTMLButtonElement {
	const found = picker
		.findAll<HTMLButtonElement>("button")
		.find((candidate) => candidate.text() === TEXT.connect);
	if (found === undefined) throw new Error("no Connect button");
	return found.element;
}

beforeEach(builder.serve);

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	builder.reset();
});

describe("a check that finds no driver", () => {
	it("shows the sentence, the install command and how to retry (fails on a missing driver shown as an unreachable server, without the install command or the way to retry)", async () => {
		builder.check.mockResolvedValue(MISSING_DRIVER);
		const picker = await checked();
		const reachable = picker.find('[data-check="reachable"]');
		expect(reachable.attributes("data-status")).toBe("failed");
		expect(reachable.text()).toContain(REASON);
		expect(reachable.text()).not.toContain("Server not reachable");
		expect(picker.find("[data-driver-install] code").text()).toBe(COMMAND);
		expect(picker.find("[data-driver-install]").text()).toContain(
			TEXT.install_retry,
		);
		expect(connectButton(picker).disabled).toBe(false);
	});

	it("runs the check again on Connect and drops the install step once the driver loads (fails on a retry that does not run the check again, or keeps the install step once the driver loads)", async () => {
		builder.check.mockResolvedValueOnce(MISSING_DRIVER);
		builder.check.mockResolvedValueOnce({
			reachable: false,
			canRead: false,
			canWrite: false,
			reason: "Nothing is listening at this host and port.",
		});
		const picker = await checked();
		connectButton(picker).click();
		await flushPromises();
		expect(builder.check).toHaveBeenCalledTimes(2);
		expect(picker.find("[data-driver-install]").exists()).toBe(false);
		expect(picker.find('[data-check="reachable"]').text()).toContain(
			"Nothing is listening at this host and port.",
		);
	});
});
