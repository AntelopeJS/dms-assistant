/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CONNECT_MEMORY_KEY,
	CONNECT_MEMORY_LIMIT_MS,
	connectMemory,
	type WrittenConnection,
} from "../app/onboarding/connect-memory";

const WRITTEN: WrittenConnection = {
	engine: "mongodb",
	connection: "shop",
	access: {
		reachable: true,
		latencyMs: 3,
		user: "reader",
		canRead: true,
		canWrite: false,
	},
};

function tabOf(owner: string | null) {
	return connectMemory(
		() => window.sessionStorage,
		() => owner,
	);
}

interface StoredWrite {
	engine: string;
	connection: string;
	access: Partial<WrittenConnection["access"]>;
	writtenAt?: number;
}

function storedWith(written: StoredWrite): string {
	return JSON.stringify({ owner: "owner-1", attempt: "a", written });
}

afterEach(() => {
	window.sessionStorage.clear();
	vi.useRealTimers();
});

describe("the connection a tab remembers across a reload", () => {
	it("reads what an earlier page of the tab wrote, with the tables module named after it, until it is cleared", () => {
		const tab = tabOf("owner-1");
		tab.write(tab.begin(), WRITTEN);
		expect(tabOf("owner-1").read()).toMatchObject({
			...WRITTEN,
			module: "builder-db-shop-tables",
		});

		tabOf("owner-1").clear();
		expect(tabOf("owner-1").read()).toBeNull();
	});

	it.each([
		["text that is not JSON", "{"],
		[
			"a connection with no attempt",
			JSON.stringify({ owner: "owner-1", written: WRITTEN }),
		],
		[
			"an engine the popup does not connect",
			storedWith({ ...WRITTEN, engine: "oracle", writtenAt: Date.now() }),
		],
		[
			"an access without its answers",
			storedWith({
				...WRITTEN,
				access: { reachable: true },
				writtenAt: Date.now(),
			}),
		],
		[
			"a connection that is not an id the popup names",
			storedWith({ ...WRITTEN, connection: "Shop DB", writtenAt: Date.now() }),
		],
		[
			"an empty connection",
			storedWith({ ...WRITTEN, connection: "", writtenAt: Date.now() }),
		],
		["a connection with no write time", storedWith(WRITTEN)],
	])("reads nothing from %s", (_, stored) => {
		window.sessionStorage.setItem(CONNECT_MEMORY_KEY, stored);
		expect(tabOf("owner-1").read()).toBeNull();
	});

	it("reads nothing another user of the tab, or of another project on the same origin, wrote", () => {
		const tab = tabOf("owner-1");
		tab.write(tab.begin(), WRITTEN);
		expect(tabOf("owner-2").read()).toBeNull();
		expect(tabOf(null).read()).toBeNull();
		expect(tabOf("owner-1").read()?.connection).toBe("shop");
	});

	it("reads nothing once the time to follow it again ran out", () => {
		vi.useFakeTimers();
		const tab = tabOf("owner-1");
		tab.write(tab.begin(), WRITTEN);
		vi.advanceTimersByTime(CONNECT_MEMORY_LIMIT_MS - 1);
		expect(tab.read()?.connection).toBe("shop");
		vi.advanceTimersByTime(1);
		expect(tab.read()).toBeNull();
	});

	it("keeps nothing when the storage refuses", () => {
		const refusing = connectMemory(
			() => {
				throw new Error("storage disabled");
			},
			() => "owner-1",
		);
		expect(() => refusing.write(refusing.begin(), WRITTEN)).not.toThrow();
		expect(refusing.read()).toBeNull();
	});

	it("keeps no write from an attempt that a later one or a clear replaced, in any popup of the tab", () => {
		const closed = tabOf("owner-1");
		const reopened = tabOf("owner-1");
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
