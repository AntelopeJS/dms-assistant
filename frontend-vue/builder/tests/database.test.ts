import { describe, expect, it } from 'vitest'
import { draftFromProposal, includeResource, settledInput } from '../app/runtime/database'
import type { MappingProposal, ProposedField, ProposedResource } from '../app/runtime/database-types'

function proposed<T>(value: T, rule = 'R6') {
	return { value, rule, kind: 'default' as const }
}

function field(column: string, relation?: string): ProposedField {
	const base: ProposedField = {
		column,
		native: 'text',
		accepts: ['string'],
		declared: proposed('string', 'F3'),
		label: proposed(column, 'L2'),
		listable: proposed(true, 'FL'),
		filterable: proposed(false, 'FL'),
		sortable: proposed(false, 'FL'),
		searchable: proposed(false, 'FL'),
	}
	if (relation) {
		base.relation = { ...proposed(relation, 'F4'), implied: false }
	}
	return base
}

function resource(relation: string, fields: ProposedField[], label: string | null): ProposedResource {
	return {
		relation,
		tableView: proposed(true),
		writable: proposed(false, 'W1'),
		label: proposed(label, 'L1'),
		title: proposed(relation.split('.')[1], 'L2'),
		fields,
		leftOut: [],
		writes: { insert: false, update: false, delete: false },
	}
}

const PROPOSAL: MappingProposal = {
	connection: 'erp',
	module: 'erp-tables',
	database: { engine: 'postgresql 17.5', role: 'erp_reader', writes: 'none' },
	resources: [
		resource('erp.customers', [field('code'), field('name')], 'name'),
		resource('erp.orders', [field('id'), field('customer_code', 'erp.customers')], 'id'),
	],
	mapped: [],
	excluded: [{ relation: 'erp.schema_migrations', reason: 'a migration tool', rule: 'R4' }],
	open: [
		{
			id: 'purpose:legacy.t_cst',
			kind: 'purpose',
			relation: 'legacy.t_cst',
			question: 'What does legacy.t_cst hold?',
			options: [],
			proposed: null,
			resource: resource('legacy.t_cst', [field('id'), field('c01')], 'id'),
		},
		{
			id: 'label:erp.orders',
			kind: 'label',
			relation: 'erp.orders',
			question: 'Which column names an order?',
			options: [],
			proposed: 'id',
		},
	],
}

describe('a mapping draft', () => {
	it('starts as the proposal: proposed relations in, a relation asked about out', () => {
		const draft = draftFromProposal(PROPOSAL)
		expect(draft.resources.map((entry) => [entry.relation, entry.include])).toEqual([
			['erp.customers', true],
			['erp.orders', true],
			['legacy.t_cst', false],
		])
	})

	it('sends the proposal as it stands, with the analysis exclusions recorded', () => {
		const input = settledInput(PROPOSAL, draftFromProposal(PROPOSAL))
		expect(input.resources.map((entry) => entry.relation)).toEqual(['erp.customers', 'erp.orders'])
		expect(input.excluded).toEqual([{ relation: 'erp.schema_migrations', reason: 'a migration tool' }])
		const orders = input.resources[1]
		expect(orders.fields[1]).toEqual({
			column: 'customer_code',
			label: 'customer_code',
			listable: true,
			filterable: false,
			sortable: false,
			searchable: false,
			relation: 'erp.customers',
		})
	})

	it('maps a relation checked in, and records one checked out as decided against', () => {
		const draft = draftFromProposal(PROPOSAL)
		includeResource(draft, 'legacy.t_cst', true)
		expect(settledInput(PROPOSAL, draft).resources.map((entry) => entry.relation)).toContain('legacy.t_cst')
		includeResource(draft, 'erp.orders', false)
		const input = settledInput(PROPOSAL, draft)
		expect(input.resources.map((entry) => entry.relation)).not.toContain('erp.orders')
		expect(input.excluded).toContainEqual({ relation: 'erp.orders', reason: 'decided against in the builder' })
		includeResource(draft, 'erp.orders', true)
		expect(settledInput(PROPOSAL, draft).excluded).not.toContainEqual(
			expect.objectContaining({ relation: 'erp.orders' }),
		)
	})

	it('keeps a relation column onto a TableView the module maps already, and drops one onto anything else', () => {
		const invoices = resource('erp.invoices', [field('id'), field('order_ref', 'erp.archive')], 'id')
		const proposal: MappingProposal = { ...PROPOSAL, resources: [invoices] }
		const draft = draftFromProposal(proposal)
		const dropped = settledInput(proposal, draft).resources[0]
		expect(dropped.fields[1].relation).toBeUndefined()
		const kept = settledInput(proposal, draft, new Set(['erp.archive'])).resources[0]
		expect(kept.fields[1].relation).toBe('erp.archive')
	})

	it('sends no title for one emptied, so the page keeps its default', () => {
		const draft = draftFromProposal(PROPOSAL)
		draft.resources[0].title = '  '
		expect(settledInput(PROPOSAL, draft).resources[0]).not.toHaveProperty('title')
	})

	it('drops a relation column whose target is no longer a TableView of the mapping', () => {
		const draft = draftFromProposal(PROPOSAL)
		includeResource(draft, 'erp.customers', false)
		const orders = settledInput(PROPOSAL, draft).resources.find((entry) => entry.relation === 'erp.orders')
		expect(orders?.fields[1].relation).toBeUndefined()
		expect(orders?.fields[1].declared).toBe('string')
	})
})
