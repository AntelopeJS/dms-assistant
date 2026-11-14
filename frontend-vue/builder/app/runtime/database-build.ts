/**
 * The build screen's state, derived from what the server answers and never stored: whether the
 * configuration declares the connection, whether the builder lists it and with what, and the
 * connection's latest analysis. A closed tab or a reload of the project resumes where things stand.
 */
import type { useBuilderApi } from './api'
import { questionText } from './database-server-text'
import { t } from './i18n'
import type { AnalysisState, DatabaseConnection, MappingProposal, OpenItem } from './database-types'

/** How long the screen waits for the project to come back before it says how to restart by hand. */
const RELOAD_LIMIT_MS = 3 * 60 * 1000

/**
 * How long the project may answer without loading the declared connection before the screen asks
 * for a restart: under `ajs project dev -w` the configuration change restarts it within seconds,
 * and without `-w` nothing does.
 */
const RESTART_AFTER_MS = 20 * 1000

type StepStatus = 'pending' | 'running' | 'done' | 'failed'

type StepKey = 'add' | 'reload' | 'connect' | 'read'

interface BuildStep {
	key: StepKey
	title: string
	status: StepStatus
	detail: string
}

/**
 * Why the connection is not loaded yet: the project does not answer (`down`), or it answers
 * without having loaded the connection its configuration declares (`stale`).
 */
export type Reload = 'down' | 'stale'

/** What could not be read because the project was down: it counts as reloading. */
const UNREACHABLE = 'unreachable'

type Unreachable = typeof UNREACHABLE

/** The three answers the screen derives from, each one possibly lost to a reload. */
interface BuildAnswers {
	/** Whether the configuration declares the connection (`GET /database/connection`). */
	declared: boolean | Unreachable
	/** The variable holding its URL, when the configuration declares it. */
	variable?: string
	/** The builder's entry for the connection (`GET /database/connections`), or null when not listed. */
	listed: DatabaseConnection | null | Unreachable
	/** The connection's latest analysis (`GET /database/analysis?connection=`), or null when none. */
	analysis: AnalysisState | null | Unreachable
}

/** What the fork says of a proposal: "8 tables: 5 pages, 2 for statistics, 3 questions". */
interface ForkSummary {
	tables: number
	pages: number
	stats: number
	questions: number
}

export interface BuildView {
	steps: BuildStep[]
	/** Why the project is reloading, when it is. */
	reload?: Reload
	/** The project was down for {@link RELOAD_LIMIT_MS}. */
	gaveUp: boolean
	/** The project answered for {@link RESTART_AFTER_MS} without loading the connection. */
	restartNeeded: boolean
	/** The project answered that it does not declare the connection. */
	undeclared: boolean
	/** The connection is listed with an error: step 3 failed with it. */
	connectionError?: string
	/** The analysis asks which schemas to read before anything else. */
	schemas?: OpenItem
	/** Connected and not analysed: the screen starts the analysis. */
	needsAnalysis: boolean
	/** The analysis read nothing mappable. */
	empty: boolean
	/** The latest analysis failed: step 4 offers to analyse again. */
	analysisFailed: boolean
	/** The analysis job the fork and *Review it myself* stand on. */
	job?: string
	fork?: ForkSummary
}

interface FetchFailure {
	data?: { code?: string }
}

function isNotFound(error: unknown): boolean {
	return (error as FetchFailure | undefined)?.data?.code === 'not_found'
}

async function readDeclared(
	api: ReturnType<typeof useBuilderApi>,
	connection: string,
): Promise<Pick<BuildAnswers, 'declared' | 'variable'>> {
	try {
		const info = await api.databaseConnection(connection)
		return { declared: true, variable: info.wiring.variable }
	} catch (error) {
		return { declared: isNotFound(error) ? false : UNREACHABLE }
	}
}

async function readListed(
	api: ReturnType<typeof useBuilderApi>,
	connection: string,
): Promise<DatabaseConnection | null | Unreachable> {
	try {
		const entries = await api.databaseConnections()
		return entries.find((entry) => entry.id === connection) ?? null
	} catch {
		return UNREACHABLE
	}
}

async function readAnalysis(
	api: ReturnType<typeof useBuilderApi>,
	connection: string,
): Promise<AnalysisState | null | Unreachable> {
	try {
		const latest = await api.latestAnalysis(connection)
		return latest.ok ? latest.data : null
	} catch (error) {
		return isNotFound(error) ? null : UNREACHABLE
	}
}

/** Reads the three answers the screen derives from. A request that failed counts as reloading. */
export async function readBuild(api: ReturnType<typeof useBuilderApi>, connection: string): Promise<BuildAnswers> {
	const [wiring, listed, analysis] = await Promise.all([
		readDeclared(api, connection),
		readListed(api, connection),
		readAnalysis(api, connection),
	])
	return { ...wiring, listed, analysis }
}

/** The questions a purpose item carries count beside it, as the workspace asks them. */
function forkSummary(proposal: MappingProposal): ForkSummary {
	const asked = proposal.open.filter((item) => item.kind !== 'schemas')
	const purposes = asked.filter((item) => item.kind === 'purpose' && item.resource)
	return {
		tables: proposal.resources.length + purposes.length,
		pages: proposal.resources.filter((resource) => resource.tableView.value).length,
		stats: proposal.resources.filter((resource) => !resource.tableView.value).length,
		questions: asked.length + purposes.reduce((count, item) => count + (item.open?.length ?? 0), 0),
	}
}

function step(key: StepKey, title: string, status: StepStatus, detail = ''): BuildStep {
	return { key, title, status, detail }
}

function addStep(answers: BuildAnswers): BuildStep {
	const title = t('database.build.add.title')
	if (answers.declared === false) {
		return step('add', title, 'failed', t('database.build.add.undeclared'))
	}
	const detail = answers.variable
		? t('database.build.add.done_variable', { variable: answers.variable })
		: t('database.build.add.done')
	return step('add', title, 'done', detail)
}

function reloadStep(answers: BuildAnswers, view: Pick<BuildView, 'reload' | 'gaveUp' | 'restartNeeded'>): BuildStep {
	const title = t('database.build.reload.title')
	if (answers.declared === false) {
		return step('reload', title, 'pending')
	}
	if (view.gaveUp) {
		return step('reload', title, 'failed', t('database.build.reload.gave_up'))
	}
	if (view.restartNeeded) {
		return step('reload', title, 'running', t('database.build.reload.restart'))
	}
	if (view.reload) {
		return step('reload', title, 'running', t('database.build.reload.running'))
	}
	return step('reload', title, 'done')
}

function listedEntry(answers: BuildAnswers): DatabaseConnection | undefined {
	return answers.listed && answers.listed !== UNREACHABLE ? answers.listed : undefined
}

function connectStep(entry: DatabaseConnection | undefined): BuildStep {
	const title = t('database.build.connect.title')
	if (!entry) {
		return step('connect', title, 'pending')
	}
	if (entry.error) {
		return step('connect', title, 'failed', entry.error)
	}
	return step('connect', title, 'done', `${entry.engine} ${entry.version} · ${entry.database} · ${entry.role}`)
}

function progressText(analysis: AnalysisState): string {
	const { described, relations, profiled, toProfile, timeouts } = analysis.progress
	const late = timeouts ? t('database.build.read.late', { timeouts }) : ''
	return t('database.build.read.progress', { described, relations, profiled, toProfile, late })
}

function readStep(analysis: AnalysisState | undefined, connected: boolean, role: string): BuildStep {
	const title = t('database.build.read.title')
	if (!connected || !analysis) {
		return step('read', title, connected ? 'running' : 'pending', connected ? t('database.build.read.starting') : '')
	}
	if (analysis.status === 'running') {
		return step('read', title, 'running', progressText(analysis))
	}
	if (analysis.status === 'failed' || !analysis.proposal) {
		return step('read', title, 'failed', t('database.build.read.failed', { error: analysis.error ?? t('database.build.read.no_proposal') }))
	}
	const schemas = analysis.proposal.open.find((item) => item.kind === 'schemas')
	if (schemas) {
		return step('read', title, 'running', questionText(schemas))
	}
	const { tables } = forkSummary(analysis.proposal)
	if (tables === 0) {
		return step('read', title, 'done', t('database.build.read.none', { role }))
	}
	return step('read', title, 'done', t('database.build.read.done', { tables: t('database.build.tables', {}, tables) }))
}

function reloadOf(answers: BuildAnswers, entry: DatabaseConnection | undefined): Reload | undefined {
	if ([answers.declared, answers.listed, answers.analysis].includes(UNREACHABLE)) {
		return 'down'
	}
	return answers.declared === true && !entry ? 'stale' : undefined
}

/**
 * Each step's status from the three answers. `reloadingFor` is how long the project has stood in
 * its current {@link Reload}, as the screen measured it.
 */
export function buildState(answers: BuildAnswers, reloadingFor = 0): BuildView {
	const entry = listedEntry(answers)
	const reload = reloadOf(answers, entry)
	const reloading = reload !== undefined
	const gaveUp = reload === 'down' && reloadingFor >= RELOAD_LIMIT_MS
	const restartNeeded = reload === 'stale' && reloadingFor >= RESTART_AFTER_MS
	const connected = !reloading && !!entry && !entry.error
	const analysis = connected && answers.analysis && answers.analysis !== UNREACHABLE ? answers.analysis : undefined
	const proposal = analysis?.status === 'done' ? analysis.proposal : undefined
	const schemas = proposal?.open.find((item) => item.kind === 'schemas')
	const summary = proposal && !schemas ? forkSummary(proposal) : undefined
	return {
		steps: [
			addStep(answers),
			reloadStep(answers, { reload, gaveUp, restartNeeded }),
			connectStep(reloading ? undefined : entry),
			readStep(analysis, connected, proposal?.database.role ?? entry?.role ?? ''),
		],
		reload,
		gaveUp,
		restartNeeded,
		undeclared: answers.declared === false,
		connectionError: !reloading ? entry?.error : undefined,
		schemas,
		needsAnalysis: connected && !analysis,
		empty: summary?.tables === 0,
		analysisFailed: !!analysis && analysis.status !== 'running' && !analysis.proposal,
		job: analysis?.id,
		fork: summary && summary.tables > 0 ? summary : undefined,
	}
}

/** The schemas the question pre-checks: `public`, or else the one with the most tables. */
export function preferredSchemas(item: OpenItem): string[] {
	const values = item.options.map((option) => String(option.value))
	if (values.includes('public')) {
		return ['public']
	}
	const counted = item.options.map((option) => ({
		value: String(option.value),
		count: Number(/\((\d+)\)$/.exec(option.title)?.[1] ?? 0),
	}))
	const largest = counted.sort((a, b) => b.count - a.count)[0]
	return largest ? [largest.value] : []
}
