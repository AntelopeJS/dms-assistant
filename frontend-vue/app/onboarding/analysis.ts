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
export type ScreenKind = "table" | "status" | "tabs" | "stats";

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
	if (!resource.tableView) return "stats";
	if (resource.tabs !== null) return "tabs";
	if (resource.fields.some((field) => field.display?.kind === "badge")) {
		return "status";
	}
	return "table";
}

/** The screens the analysis proposes, pre-ticked, then those it asks about, unticked. */
export function screensOf(proposal: MappingProposal): ProposedScreen[] {
	return draftFromProposal(proposal).resources.map((resource) => ({
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

/** "Build directly": the builder's `MapResources` call for the ticked screens, as the analysis proposed them. */
export function mappingInput(
	proposal: MappingProposal,
	ticked: ReadonlySet<string>,
): MapResourcesInput {
	const draft = draftFromProposal(proposal);
	for (const resource of draft.resources) {
		includeResource(draft, resource.relation, ticked.has(resource.relation));
	}
	return settledInput(proposal, draft);
}
