// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
	CONNECT_MEMORY_KEY,
	connectMemory,
	type WrittenConnection,
} from "../app/onboarding/connect-memory";

const WRITTEN: WrittenConnection = {
	engine: "mongodb",
	connection: "shop",
	module: "builder-db-shop-tables",
	access: {
		reachable: true,
		latencyMs: 3,
		user: "reader",
		canRead: true,
		canWrite: false,
	},
};

afterEach(() => {
	window.sessionStorage.clear();
});

describe("the connection a tab remembers across a reload", () => {
	it("reads what an earlier page of the tab wrote, until it is cleared", () => {
		const tab = connectMemory(() => window.sessionStorage);
		tab.write(tab.begin(), WRITTEN);
		const reloaded = connectMemory(() => window.sessionStorage);
		expect(reloaded.read()).toEqual(WRITTEN);

		reloaded.clear();
		expect(connectMemory(() => window.sessionStorage).read()).toBeNull();
	});

	it.each([
		["text that is not JSON", "{"],
		["a connection with no attempt", JSON.stringify({ written: WRITTEN })],
		[
			"an engine the popup does not connect",
			JSON.stringify({
				attempt: "a",
				written: { ...WRITTEN, engine: "oracle" },
			}),
		],
		[
			"an access without its answers",
			JSON.stringify({
				attempt: "a",
				written: { ...WRITTEN, access: { reachable: true } },
			}),
		],
	])("reads nothing from %s", (_, stored) => {
		window.sessionStorage.setItem(CONNECT_MEMORY_KEY, stored);
		expect(connectMemory(() => window.sessionStorage).read()).toBeNull();
	});

	it("keeps nothing when the storage refuses", () => {
		const refusing = connectMemory(() => {
			throw new Error("storage disabled");
		});
		expect(() => refusing.write(refusing.begin(), WRITTEN)).not.toThrow();
		expect(refusing.read()).toBeNull();
	});

	it("keeps no write from an attempt that a later one or a clear replaced, in any popup of the tab", () => {
		const closed = connectMemory(() => window.sessionStorage);
		const reopened = connectMemory(() => window.sessionStorage);
		const first = closed.begin();
		const later = reopened.begin();
		reopened.write(later, { ...WRITTEN, connection: "crm" });
		closed.write(first, WRITTEN);
		expect(reopened.read()?.connection).toBe("crm");

		const cleared = closed.begin();
		reopened.clear();
		closed.write(cleared, WRITTEN);
		expect(reopened.read()).toBeNull();
	});
});
