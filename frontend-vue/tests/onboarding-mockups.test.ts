import { describe, expect, it } from "vitest";
import { listMockups, MOCKUPS_PATH } from "../app/onboarding/mockups";

const SHOP = {
	name: "shop",
	title: "Shop back office",
	pages: 3,
	openComments: 2,
	source: "claude-code",
	updatedAt: "2026-11-12T09:00:00.000Z",
	status: "built",
	builtAt: "2026-11-12T10:00:00.000Z",
	builtPages: [{ path: "/orders", title: "Orders" }],
};

const CRM = {
	name: "crm",
	pages: 1,
	openComments: 0,
	updatedAt: "2026-11-13T08:00:00.000Z",
	status: "draft",
};

function answering(body: unknown) {
	return async (path: string) => {
		expect(path).toBe(MOCKUPS_PATH);
		return body;
	};
}

describe("the popup's mockups", () => {
	it("reads the rows of GET /api/mockup, latest first, titled by their name when they have no title", async () => {
		const mockups = await listMockups(
			answering({ results: [SHOP, CRM], total: 2 }),
		);
		expect(mockups).toEqual([
			{
				name: "crm",
				title: "crm",
				pages: 1,
				source: undefined,
				status: "draft",
				updatedAtMs: Date.parse(CRM.updatedAt),
				openComments: 0,
			},
			{
				name: "shop",
				title: "Shop back office",
				pages: 3,
				source: "claude-code",
				status: "built",
				updatedAtMs: Date.parse(SHOP.updatedAt),
				openComments: 2,
			},
		]);
	});

	it("leaves out a row of another shape and keeps the others", async () => {
		const mockups = await listMockups(
			answering({ results: [{ ...SHOP, name: undefined }, CRM], total: 2 }),
		);
		expect(mockups.map((mockup) => mockup.name)).toEqual(["crm"]);
	});

	it("lists a mockup whose source it does not know, without a source", async () => {
		const mockups = await listMockups(
			answering({ results: [{ ...CRM, source: "cursor" }], total: 1 }),
		);
		expect(mockups).toHaveLength(1);
		expect(mockups[0]?.source).toBeUndefined();
	});

	it("reads a DMS without the mockups route as none", async () => {
		const mockups = await listMockups(async () => {
			throw Object.assign(new Error("Not Found"), { statusCode: 404 });
		});
		expect(mockups).toEqual([]);
	});

	it("passes on any other failure", async () => {
		const failing = listMockups(async () => {
			throw Object.assign(new Error("Server Error"), { statusCode: 500 });
		});
		await expect(failing).rejects.toThrow("Server Error");
	});
});
