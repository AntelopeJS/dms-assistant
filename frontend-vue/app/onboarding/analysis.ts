import {
	draftFromProposal,
	includeResource,
	type ResourceDraft,
	settledInput,
} from "../../builder/app/runtime/database";
import type {
	MappingProposal,
	MapResourcesInput,
} from "../../builder/app/runtime/database-types";

/** How a proposed screen shows its table. */
export type ScreenKind = "table" | "status" | "tabs";

export interface ProposedScreen {
	relation: string;
	title: string;
	kind: ScreenKind;
	/** The analysis proposes it; a relation it only asks about starts unticked. */
	ticked: boolean;
}

export interface AnalysedTable {
	relation: string;
	rows?: number;
}

function kindOf(resource: ResourceDraft): ScreenKind {
	if (resource.tabs !== null) return "tabs";
	if (resource.fields.some((field) => field.display?.kind === "badge")) {
		return "status";
	}
	return "table";
}

/**
 * The relations the catalog keeps from a page (no key, a link table): mapped for stats as
 * proposed, never offered as a screen. A stats-only verdict that is a default is a screen.
 */
function statsOnly(proposal: MappingProposal): Set<string> {
	return new Set(
		proposal.resources
			.filter(
				(resource) =>
					!resource.tableView.value && resource.tableView.kind === "fact",
			)
			.map((resource) => resource.relation),
	);
}

/** The screens the analysis proposes, pre-ticked, then those it asks about, unticked. */
export function screensOf(proposal: MappingProposal): ProposedScreen[] {
	const kept = statsOnly(proposal);
	return draftFromProposal(proposal)
		.resources.filter((resource) => !kept.has(resource.relation))
		.map((resource) => ({
			relation: resource.relation,
			title: resource.title.trim() || resource.relation,
			kind: kindOf(resource),
			ticked: resource.include,
		}));
}

/** Every table the analysis read, with its rows when it counted them. */
export function tablesOf(proposal: MappingProposal): AnalysedTable[] {
	const asked = proposal.open.flatMap((item) =>
		item.kind === "purpose" && item.resource ? [item.resource] : [],
	);
	return [...proposal.resources, ...asked].map((resource) => ({
		relation: resource.relation,
		rows: resource.rows,
	}));
}

/**
 * "Build directly": the builder's `MapResources` call that gives every ticked screen a page, as
 * the analysis proposed it otherwise, and maps the relations kept from a page for stats.
 */
export function mappingInput(
	proposal: MappingProposal,
	ticked: ReadonlySet<string>,
): MapResourcesInput {
	const kept = statsOnly(proposal);
	const draft = draftFromProposal(proposal);
	for (const resource of draft.resources) {
		if (kept.has(resource.relation)) continue;
		includeResource(draft, resource.relation, ticked.has(resource.relation));
		resource.tableView = true;
	}
	return settledInput(proposal, draft);
}
