import { describe, expect, it } from 'vitest'
import { buildState, preferredSchemas } from '../app/runtime/database-build'
import type {
	AnalysisState,
	DatabaseConnection,
	MappingProposal,
	OpenItem,
	ProposedResource,
} from '../app/runtime/database-types'

type BuildAnswers = Parameters<typeof buildState>[0]

const THREE_MINUTES_MS = 3 * 60 * 1000
const TWENTY_SECONDS_MS = 20 * 1000

function proposed<T>(value: T) {
	return { value, rule: 'R1', kind: 'default' as const }
}

function resource(relation: string, tableView: boolean): ProposedResource {
	return {
		relation,
		tableView: proposed(tableView),
		writable: proposed(false),
		label: proposed(null),
		title: proposed(relation),
		fields: [],
		leftOut: [],
		writes: { insert: false, update: false, delete: false },
	}
}

function item(id: string, kind: OpenItem['kind'], extra: Partial<OpenItem> = {}): OpenItem {
	return { id, kind, question: id, options: [], proposed: null, ...extra }
}

/** The seed database's proposal: 5 pages, 2 for statistics, 2 labels and a purpose. */
const SEED: MappingProposal = {
	connection: 'orb',
	module: 'builder-db-orb-tables',
	database: { engine: 'postgresql', role: 'reader', writes: 'none' },
	resources: [
		...['customers', 'employees', 'invoices', 'orders', 'products'].map((name) => resource(`public.${name}`, true)),
		resource('public.categories', false),
		resource('public.suppliers', false),
	],
	excluded: [],
	mapped: [],
	open: [
		item('label:customers', 'label', { relation: 'public.customers' }),
		item('label:orders', 'label', { relation: 'public.orders' }),
		item('purpose:order_items', 'purpose', {
			relation: 'public.order_items',
			resource: resource('public.order_items', false),
		}),
	],
}

const LISTED: DatabaseConnection = {
	id: 'orb',
	engine: 'postgresql',
	version: '16.15',
	database: 'orb',
	role: 'reader',
}

function job(status: AnalysisState['status'], proposal?: MappingProposal): AnalysisState {
	return {
		id: 'job-1',
		connection: 'orb',
		status,
		progress: { relations: 8, described: 8, toProfile: 8, profiled: 3, timeouts: 0 },
		proposal,
	}
}

function statuses(answers: BuildAnswers, reloadingFor = 0): string[] {
	return buildState(answers, reloadingFor).steps.map((step) => step.status)
}

describe('the build steps, derived from the three answers', () => {
	it('reads a failed request as the project reloading', () => {
		const answers: BuildAnswers = { declared: 'unreachable', listed: 'unreachable', analysis: 'unreachable' }
		expect(statuses(answers)).toEqual(['done', 'running', 'pending', 'pending'])
		expect(buildState(answers).reload).toBe('down')
	})

	it('waits on the reload while the connection is declared and not listed yet', () => {
		const answers: BuildAnswers = { declared: true, variable: 'BUILDER_DB_ORB_URL', listed: null, analysis: null }
		const view = buildState(answers)
		expect(statuses(answers)).toEqual(['done', 'running', 'pending', 'pending'])
		expect(view.steps[0]?.detail).toContain('BUILDER_DB_ORB_URL')
		expect(view.needsAnalysis).toBe(false)
	})

	it('fails step 3 with the error the connection reports', () => {
		const answers: BuildAnswers = {
			declared: true,
			listed: { id: 'orb', error: 'PostgreSQL adapter is not connected: wrong user or password (28P01)' },
			analysis: null,
		}
		const view = buildState(answers)
		expect(statuses(answers)).toEqual(['done', 'done', 'failed', 'pending'])
		expect(view.connectionError).toContain('wrong user or password')
		expect(view.needsAnalysis).toBe(false)
	})

	it('asks for the analysis once connected and none exists', () => {
		const answers: BuildAnswers = { declared: true, listed: LISTED, analysis: null }
		expect(statuses(answers)).toEqual(['done', 'done', 'done', 'running'])
		expect(buildState(answers).needsAnalysis).toBe(true)
	})

	it('shows the analysis progress while it runs', () => {
		const answers: BuildAnswers = { declared: true, listed: LISTED, analysis: job('running') }
		const view = buildState(answers)
		expect(view.steps[3]).toMatchObject({ status: 'running', detail: '8 of 8 tables described, 3 of 8 profiled.' })
		expect(view.needsAnalysis).toBe(false)
		expect(view.fork).toBeUndefined()
	})

	it('fails step 4 with the analysis error', () => {
		const answers: BuildAnswers = { declared: true, listed: LISTED, analysis: { ...job('failed'), error: 'timeout' } }
		const view = buildState(answers)
		expect(view.steps[3]).toMatchObject({ status: 'failed', detail: 'The analysis failed: timeout' })
		expect(view.analysisFailed).toBe(true)
		expect(view.needsAnalysis).toBe(false)
	})

	it('asks the schemas question instead of forking', () => {
		const schemas = item('schemas:orb', 'schemas', { options: [{ value: 'sales', title: 'sales (150)' }] })
		const answers: BuildAnswers = {
			declared: true,
			listed: LISTED,
			analysis: job('done', { ...SEED, resources: [], open: [schemas] }),
		}
		const view = buildState(answers)
		expect(view.schemas?.id).toBe('schemas:orb')
		expect(view.steps[3]?.status).toBe('running')
		expect(view.fork).toBeUndefined()
	})

	it('forks on a finished analysis, on its job', () => {
		const answers: BuildAnswers = { declared: true, listed: LISTED, analysis: job('done', SEED) }
		const view = buildState(answers)
		expect(statuses(answers)).toEqual(['done', 'done', 'done', 'done'])
		expect(view.fork).toEqual({ tables: 8, pages: 5, stats: 2, questions: 3 })
		expect(view.job).toBe('job-1')
	})

	it('ends without a fork when there is nothing the role can read', () => {
		const answers: BuildAnswers = {
			declared: true,
			listed: LISTED,
			analysis: job('done', { ...SEED, resources: [], open: [] }),
		}
		const view = buildState(answers)
		expect(view.empty).toBe(true)
		expect(view.allMapped).toBe(false)
		expect(view.fork).toBeUndefined()
		expect(view.steps[3]?.detail).toBe('No tables user reader can read.')
	})

	it('says every table is mapped already when the proposal holds none and the module maps some', () => {
		const answers: BuildAnswers = {
			declared: true,
			listed: LISTED,
			analysis: job('done', { ...SEED, resources: [], open: [], mapped: ['orders', 'users'] }),
		}
		const view = buildState(answers)
		expect(view.allMapped).toBe(true)
		expect(view.empty).toBe(false)
		expect(view.fork).toBeUndefined()
		expect(view.steps[3]?.detail).toContain('Every table is mapped already')
	})

	it('fails the reload after 3 minutes with how to restart by hand, and not before', () => {
		const answers: BuildAnswers = { declared: 'unreachable', listed: 'unreachable', analysis: 'unreachable' }
		expect(buildState(answers, THREE_MINUTES_MS - 1).steps[1]?.status).toBe('running')
		const late = buildState(answers, THREE_MINUTES_MS)
		expect(late.gaveUp).toBe(true)
		expect(late.steps[1]).toMatchObject({ status: 'failed' })
		expect(late.steps[1]?.detail).toContain('Restart it by hand')
	})

	it('asks for a restart once the project has answered for 20 seconds without the connection, and keeps waiting', () => {
		const answers: BuildAnswers = { declared: true, listed: null, analysis: null }
		expect(buildState(answers, TWENTY_SECONDS_MS - 1).restartNeeded).toBe(false)
		expect(buildState(answers, TWENTY_SECONDS_MS).restartNeeded).toBe(true)
		const late = buildState(answers, THREE_MINUTES_MS)
		expect(late.restartNeeded).toBe(true)
		expect(late.gaveUp).toBe(false)
		expect(late.steps[1]).toMatchObject({ status: 'running' })
		expect(late.steps[1]?.detail).toContain('ajs project dev -w')
	})

	it('asks for no restart while the project does not answer', () => {
		const answers: BuildAnswers = { declared: 'unreachable', listed: 'unreachable', analysis: 'unreachable' }
		expect(buildState(answers, TWENTY_SECONDS_MS).restartNeeded).toBe(false)
	})

	it('fails step 1 when the configuration no longer declares the connection', () => {
		expect(statuses({ declared: false, listed: null, analysis: null })[0]).toBe('failed')
	})
})

describe('the fork summary', () => {
	const fork = (proposal: MappingProposal) =>
		buildState({ declared: true, listed: LISTED, analysis: job('done', proposal) }).fork

	it('counts a purpose item as a table, and its own questions with the open items', () => {
		const withQuestions: MappingProposal = {
			...SEED,
			open: SEED.open.map((entry) =>
				entry.kind === 'purpose' ? { ...entry, open: [item('label:order_items', 'label')] } : entry,
			),
		}
		expect(fork(withQuestions)).toEqual({ tables: 8, pages: 5, stats: 2, questions: 4 })
	})

	it('counts field-type items as questions', () => {
		const typed = { ...SEED, open: [...SEED.open, item('field-type:orders.total', 'field-type')] }
		expect(fork(typed)?.questions).toBe(4)
	})
})

describe('the schemas the question pre-checks', () => {
	it('checks public when the database has it', () => {
		const schemas = item('s', 'schemas', {
			options: [
				{ value: 'sales', title: 'sales (300)' },
				{ value: 'public', title: 'public (12)' },
			],
		})
		expect(preferredSchemas(schemas)).toEqual(['public'])
	})

	it('checks the largest schema otherwise', () => {
		const schemas = item('s', 'schemas', {
			options: [
				{ value: 'hr', title: 'hr (40)' },
				{ value: 'sales', title: 'sales (300)' },
			],
		})
		expect(preferredSchemas(schemas)).toEqual(['sales'])
	})
})
