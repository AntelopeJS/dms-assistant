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

vi.mock("../builder/app/runtime/api", () => ({
	useBuilderApi: () => ({
		projectModules: builder.projectModules,
		checkConnection: builder.checkConnection,
		failure: (error: unknown) => ({ detail: String(error) }),
	}),
}));

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
const COMMAND = 'pnpm add --save-prefix=~ "@antelopejs/postgres@>=0.4.2 <0.5.0"';
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
	builder.projectModules.mockResolvedValue(PROJECT);
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

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	builder.projectModules.mockReset();
	builder.checkConnection.mockReset();
});

describe("a check that finds no driver", () => {
	/** Fails on a missing driver shown as an unreachable server, without the install command or the way to retry. */
	it("shows the sentence, the install command and how to retry", async () => {
		builder.checkConnection.mockResolvedValue(MISSING_DRIVER);
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

	/** Fails on a retry that does not run the check again, or keeps the install step once the driver loads. */
	it("runs the check again on Connect and drops the install step once the driver loads", async () => {
		builder.checkConnection.mockResolvedValueOnce(MISSING_DRIVER);
		builder.checkConnection.mockResolvedValueOnce({
			reachable: false,
			canRead: false,
			canWrite: false,
			reason: "Nothing is listening at this host and port.",
		});
		const picker = await checked();
		connectButton(picker).click();
		await flushPromises();
		expect(builder.checkConnection).toHaveBeenCalledTimes(2);
		expect(picker.find("[data-driver-install]").exists()).toBe(false);
		expect(picker.find('[data-check="reachable"]').text()).toContain(
			"Nothing is listening at this host and port.",
		);
	});
});
