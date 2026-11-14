/**
 * The builder's decision code for a database mapping: the proposal the analysis
 * answered, turned into a draft the integrator edits, and the draft turned into
 * the `MapResources` call Apply sends.
 */
import type {
	ColumnDisplay,
	MapResourcesInput,
	MappedField,
	MappedResource,
	MappingProposal,
	ProposedField,
	ProposedResource,
	TabsChoice,
} from './database-types'
import { sentDisplay, sentTabs } from './database-display'

export interface FieldDraft {
	column: string
	include: boolean
	declared: string
	label: string
	listable: boolean
	filterable: boolean
	sortable: boolean
	searchable: boolean
	/** How the column is drawn; null for a plain column. */
	display: ColumnDisplay | null
	relation: string | null
}

export interface ResourceDraft {
	relation: string
	include: boolean
	tableView: boolean
	writable: boolean
	label: string | null
	title: string
	/** The badge column the TableView is tabbed by; null for no tabs. */
	tabs: TabsChoice | null
	fields: FieldDraft[]
}

interface MappingDraft {
	connection: string
	module: string
	resources: ResourceDraft[]
	/** Relations decided against here, with why. */
	excluded: Record<string, string>
}

function fieldDraft(field: ProposedField): FieldDraft {
	return {
		column: field.column,
		include: true,
		declared: field.declared.value,
		label: field.label.value,
		listable: field.listable.value,
		filterable: field.filterable.value,
		sortable: field.sortable.value,
		searchable: field.searchable.value,
		display: field.display?.value ?? null,
		relation: field.relation?.value ?? null,
	}
}

function resourceDraft(resource: ProposedResource, include: boolean): ResourceDraft {
	return {
		relation: resource.relation,
		include,
		tableView: resource.tableView.value,
		writable: resource.writable.value,
		label: resource.label.value,
		title: resource.title.value,
		tabs: resource.tabs?.value ?? null,
		fields: resource.fields.map(fieldDraft),
	}
}

/** The proposal as it stands, every proposed relation in and every question unanswered. */
export function draftFromProposal(proposal: MappingProposal): MappingDraft {
	const asked = proposal.open
		.filter((item) => item.kind === 'purpose' && item.resource)
		.map((item) => resourceDraft(item.resource!, false))
	return {
		connection: proposal.connection,
		module: proposal.module,
		resources: [
			...proposal.resources.map((resource) => resourceDraft(resource, true)),
			...asked,
		],
		excluded: {},
	}
}

function resourceIn(
	draft: MappingDraft,
	relation: string | undefined,
): ResourceDraft | undefined {
	return draft.resources.find((resource) => resource.relation === relation)
}

/** Checks a relation in or out of the mapping; out, it is recorded as decided against. */
export function includeResource(draft: MappingDraft, relation: string, include: boolean): void {
	const resource = resourceIn(draft, relation)
	if (!resource) {
		return
	}
	resource.include = include
	if (include) {
		delete draft.excluded[relation]
	} else {
		draft.excluded[relation] = 'decided against in the builder'
	}
}

/**
 * A relation column survives only onto a TableView: one this mapping keeps as
 * such, or one the module maps already.
 */
function relationKept(
	draft: MappingDraft,
	relation: string | null,
	mappedTableViews: ReadonlySet<string>,
): string | undefined {
	if (!relation) {
		return undefined
	}
	const target = resourceIn(draft, relation)
	if (target) {
		return target.include && target.tableView ? relation : undefined
	}
	return mappedTableViews.has(relation) ? relation : undefined
}

function mappedField(
	draft: MappingDraft,
	field: FieldDraft,
	mappedTableViews: ReadonlySet<string>,
): MappedField {
	const mapped: MappedField = {
		column: field.column,
		label: field.label,
		listable: field.listable,
		filterable: field.filterable,
		sortable: field.sortable,
		searchable: field.searchable,
	}
	const relation = relationKept(draft, field.relation, mappedTableViews)
	if (relation) {
		mapped.relation = relation
	} else {
		mapped.declared = field.declared
		mapped.display = sentDisplay(field)
	}
	return mapped
}

function mappedResource(
	draft: MappingDraft,
	resource: ResourceDraft,
	mappedTableViews: ReadonlySet<string>,
): MappedResource {
	const mapped: MappedResource = {
		relation: resource.relation,
		tableView: resource.tableView,
		writable: resource.tableView && resource.writable,
		fields: resource.fields
			.filter((field) => field.include)
			.map((field) => mappedField(draft, field, mappedTableViews)),
	}
	if (resource.title.trim()) {
		mapped.title = resource.title.trim()
	}
	if (resource.label) {
		mapped.label = resource.label
	}
	mapped.tabs = resource.tableView ? sentTabs(resource) : null
	return mapped
}

/**
 * The one `MapResources` call Apply sends: the relations kept, and the ones
 * decided against — the analysis's exclusions the integrator let stand, and
 * their own — so the next analysis does not propose them again. A question left
 * unanswered is not recorded, and comes back next time.
 */
export function settledInput(
	proposal: MappingProposal,
	draft: MappingDraft,
	mappedTableViews: ReadonlySet<string> = new Set(),
): MapResourcesInput {
	const excluded = new Map<string, string>(
		proposal.excluded.map((entry) => [entry.relation, entry.reason]),
	)
	for (const [relation, reason] of Object.entries(draft.excluded)) {
		excluded.set(relation, reason)
	}
	return {
		module: draft.module,
		connection: draft.connection,
		resources: draft.resources
			.filter((resource) => resource.include)
			.map((resource) => mappedResource(draft, resource, mappedTableViews)),
		excluded: [...excluded].map(([relation, reason]) => ({ relation, reason })),
	}
}
