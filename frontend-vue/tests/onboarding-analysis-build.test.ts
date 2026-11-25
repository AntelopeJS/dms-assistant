import { describe, expect, it } from "vitest";
import type {
	MappingProposal,
	ProposedResource,
} from "../builder/app/runtime/database-types";
import { mappingInput, screensOf } from "../app/onboarding/analysis";
import { proposedRelation } from "./support/database-connect";

/** A relation the analysis maps for stats only, by a rule of the given kind. */
function statsOnly(
	relation: string,
	rule: string,
	kind: "fact" | "default",
): ProposedResource {
	return {
		...proposedRelation(relation),
		tableView: { value: false, rule, kind },
	};
}

/**
 * The analysis of the PostgreSQL shop sample: R6 and R7 give seven relations a TableView, R8 maps
 * payments, returns, subscriptions and support tickets for stats only, and order items is a
 * `purpose` question. A link table (R5) and a keyless relation (R2) stand for the catalog facts no
 * page can override.
 */
const SHOP: MappingProposal = {
	connection: "shop",
	module: "m",
	database: { engine: "postgresql", role: "reader", writes: "none" },
	resources: [
		...[
			"public.customers",
			"public.categories",
			"public.products",
			"public.coupons",
			"public.orders",
			"public.shipments",
			"public.reviews",
		].map(proposedRelation),
		...[
			"public.payments",
			"public.returns",
			"public.subscriptions",
			"public.support_tickets",
		].map((relation) => statsOnly(relation, "R8", "default")),
		statsOnly("public.product_tags", "R5", "fact"),
		statsOnly("public.audit_log", "R2", "fact"),
	],
	excluded: [],
	mapped: [],
	open: [
		{
			id: "purpose:public.order_items",
			kind: "purpose",
			relation: "public.order_items",
			question: "What should public.order_items become?",
			options: [],
			proposed: null,
			resource: proposedRelation("public.order_items"),
		},
	],
};

function ticked(proposal: MappingProposal): Set<string> {
	return new Set(
		screensOf(proposal)
			.filter((screen) => screen.ticked)
			.map((screen) => screen.relation),
	);
}

describe("Build directly on the shop sample", () => {
	it("maps every ticked screen as a page, the four the analysis proposes for stats only included (fails when a ticked screen is sent without a TableView)", () => {
		const choice = ticked(SHOP);
		const input = mappingInput(SHOP, choice);

		const pages = input.resources
			.filter((resource) => resource.tableView)
			.map((resource) => resource.relation);
		expect(new Set(pages)).toEqual(choice);
		expect(choice.size).toBe(11);
	});

	it("maps a screen ticked from a question as a page too (fails when a question's relation is left out)", () => {
		const choice = ticked(SHOP).add("public.order_items");
		const input = mappingInput(SHOP, choice);

		expect(
			input.resources.find(
				(resource) => resource.relation === "public.order_items",
			)?.tableView,
		).toBe(true);
	});

	it("leaves the tabs of a page made from a stats-only proposal to the builder, which tabs a new relation by its status (fails when such a page is sent with tabs null, which writes none)", () => {
		const input = mappingInput(SHOP, ticked(SHOP));
		const tabs = (relation: string) =>
			"tabs" in
			(input.resources.find((resource) => resource.relation === relation) ??
				{});

		expect(tabs("public.payments")).toBe(false);
		expect(tabs("public.orders")).toBe(true);
	});

	it("lists no screen for a relation the catalog keeps from a page, and still maps it for stats (fails when a link table or a keyless relation is offered as a screen, or dropped from the mapping)", () => {
		const relations = screensOf(SHOP).map((screen) => screen.relation);
		const input = mappingInput(SHOP, ticked(SHOP));

		for (const relation of ["public.product_tags", "public.audit_log"]) {
			expect(relations).not.toContain(relation);
			expect(
				input.resources.find((resource) => resource.relation === relation)
					?.tableView,
			).toBe(false);
		}
	});

	it("leaves an unticked screen out and records it as decided against (fails when unticking still builds its page)", () => {
		const choice = ticked(SHOP);
		choice.delete("public.payments");
		const input = mappingInput(SHOP, choice);

		expect(input.resources.map((resource) => resource.relation)).not.toContain(
			"public.payments",
		);
		expect((input.excluded ?? []).map((entry) => entry.relation)).toContain(
			"public.payments",
		);
	});
});
