import { describe, expect, it } from "vitest";
import { databaseMockupPrompt } from "../app/onboarding/prompts";

const PROMPT = databaseMockupPrompt("roaster", "builder-db-roaster-tables", [
	{ title: "Orders", relation: "public.orders" },
	{ title: "Customers", relation: "public.customers" },
]);

describe("databaseMockupPrompt", () => {
	it("names the dms-mockup skill and not the database skill", () => {
		expect(PROMPT).toContain("dms-mockup skill");
		expect(PROMPT).not.toContain("dms-external-database");
	});

	it("names the connection, the module and every screen", () => {
		expect(PROMPT).toContain("connection roaster");
		expect(PROMPT).toContain("module builder-db-roaster-tables");
		expect(PROMPT).toContain(
			"- Orders (public.orders)\n- Customers (public.customers)",
		);
	});

	it("forbids analysing the database again and points to the read-only database tools", () => {
		expect(PROMPT).toContain("do not call builder_analyse_database again");
		for (const tool of [
			"database_describe",
			"database_relations",
			"database_profile",
		]) {
			expect(PROMPT).toContain(tool);
		}
	});
});
