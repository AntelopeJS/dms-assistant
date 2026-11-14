// A local mirror of the database shapes of `@antelopejs/interface-dms-builder`
// and `@antelopejs/interface-database-catalog`, as the module's HTTP API
// answers them.

import type { DatabaseEngine } from './database-engines'

type ProposedKind = 'fact' | 'default'

interface Proposed<T> {
	value: T
	rule: string
	kind: ProposedKind
}

interface ProposedColumnProfile {
	traits: string[]
	nulls?: number
	distinct?: number
	range?: { min: number | string; max: number | string }
	categories?: { value: string | number | boolean; rows: number }[]
}

type DisplayTone = 'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'

interface BadgeItem {
	value: string
	label: string
	tone: DisplayTone
}

/** How a column is drawn: a badge of toned values, or a price. */
export type ColumnDisplay = { kind: 'badge'; items: BadgeItem[] } | { kind: 'price' }

/** Tabs above a TableView, by the values of a badge column. */
export interface TabsChoice {
	column: string
}

export interface ProposedField {
	column: string
	native: string
	accepts: string[]
	declared: Proposed<string> & { lossy?: string }
	label: Proposed<string>
	listable: Proposed<boolean>
	filterable: Proposed<boolean>
	sortable: Proposed<boolean>
	searchable: Proposed<boolean>
	display?: Proposed<ColumnDisplay>
	relation?: Proposed<string> & { implied: boolean }
	profile?: ProposedColumnProfile
}

interface ProposedLeftOut {
	column: string
	reason: string
	rule: string
}

interface ProposedWrites {
	insert: boolean
	update: boolean
	delete: boolean
}

export interface ProposedResource {
	relation: string
	tableView: Proposed<boolean>
	writable: Proposed<boolean>
	label: Proposed<string | null>
	title: Proposed<string>
	tabs?: Proposed<TabsChoice>
	fields: ProposedField[]
	leftOut: ProposedLeftOut[]
	writes: ProposedWrites
	rows?: number
	/** The rows its column profiles were measured on; a column's `nulls` is out of these. */
	profiledRows?: number
}

interface ProposedExclusion {
	relation: string
	reason: string
	rule: string
}

type OpenItemKind = 'schemas' | 'purpose' | 'label' | 'reference' | 'field-type'

interface OpenItemOption {
	value: unknown
	title: string
}

export interface OpenItem {
	id: string
	kind: OpenItemKind
	relation?: string
	column?: string
	question: string
	options: OpenItemOption[]
	proposed: unknown
	resource?: ProposedResource
	open?: OpenItem[]
}

export interface MappingProposal {
	connection: string
	module: string
	database: { engine: string; role: string; writes: 'none' | 'some' | 'all' }
	resources: ProposedResource[]
	excluded: ProposedExclusion[]
	open: OpenItem[]
}

interface AnalysisProgress {
	relations: number
	described: number
	toProfile: number
	profiled: number
	timeouts: number
}

export interface AnalysisState {
	id: string
	connection: string
	status: 'running' | 'done' | 'failed'
	progress: AnalysisProgress
	proposal?: MappingProposal
	error?: string
}

/** A relation the module maps, read back as its current choices. */
export interface MappedRelation {
	ref: string
	resource: ProposedResource
	/** The columns the module declares; the rest are the catalog's others. */
	included: string[]
}

export interface MappedField {
	column: string
	declared?: string
	label?: string
	listable?: boolean
	filterable?: boolean
	sortable?: boolean
	searchable?: boolean
	display?: ColumnDisplay | null
	relation?: string
}

export interface MappedResource {
	relation: string
	label?: string
	title?: string
	tableView: boolean
	writable: boolean
	fields: MappedField[]
	tabs?: TabsChoice | null
}

export interface MapResourcesInput {
	module: string
	connection: string
	resources: MappedResource[]
	excluded?: { relation: string; reason: string }[]
}

export interface MapResourcesResult {
	resources: { relation: string; ref: string; page?: string; files: string[] }[]
	leftOut: { relation: string; column: string; reason: string }[]
	category?: string
}

/** One of the builder's catalog connections, or why its provider did not answer. */
export interface DatabaseConnection {
	id: string
	engine?: string
	version?: string
	database?: string
	role?: string
	error?: string
}

/** What `POST /database/connections/check` found of a URL, before anything is written. */
export interface DatabaseAccess {
	/** A server answered, even to refuse the sign-in. */
	reachable: boolean
	/** The round trip of the first query the signed-in account made; absent when it did not sign in. */
	latencyMs?: number
	/** The account the server reports. */
	user?: string
	canRead: boolean
	canWrite: boolean
	/** Why the database cannot be read, in a sentence that never holds the URL or the password. */
	reason?: string
}

interface SampledText {
	text: string
	truncated: boolean
}

interface SampledBinary {
	bytes: number
}

type SampledValue = SampledText | SampledBinary | null

export interface RowSample {
	relation: string
	columns: string[]
	rows: SampledValue[][]
	sample: { percent: number; rows: number } | null
}

export interface ModuleEntryInput {
	source?: Record<string, unknown>
	config?: Record<string, unknown>
	env?: Record<string, string>
	importOverrides?: { interface: string; source: string; id?: string }[]
	exportPriority?: Record<string, number>
	disabledExports?: string[]
}

export type ProjectConfigStep =
	| { op: 'AddModule'; id: string; entry: ModuleEntryInput }
	| { op: 'ConfigureModule'; id: string; entry: ModuleEntryInput }
	| { op: 'CreateLocalModule'; id: string; path: string; entry?: ModuleEntryInput; connection?: string }

/**
 * The `interface-database` pin a module needs so the tables module's own pin to the new database
 * leaves it on the project's default one.
 */
interface DatabasePin {
	module: string
	provider: string
}

/** A driver module of an engine, and the range of its versions the project can install. */
export interface DriverPackage {
	package: string
	version: string
}

/** The modules the project's configuration lists, and what connecting a database needs of them. */
export interface ProjectModules {
	modules: string[]
	/** The id `antelope.config.ts` gives `@antelopejs/dms`, which holds the catalog connections. */
	self: string
	/** The project's own `interface-database` provider, when it has one. */
	ownDatabase?: string
	/** The modules to pin to the own database, each one importing `interface-database` without a pin. */
	databasePins: DatabasePin[]
	/** The id `antelope.config.ts` gives dms-database, whose console lists the connections registered with it. */
	dmsDatabase?: string
	/** The version of `@antelopejs/interface-database` the project resolves, when it resolves one. */
	interfaceDatabase?: string
	/** The driver of each engine a project on `interfaceDatabase` can install; an engine without one is absent. */
	drivers: Partial<Record<DatabaseEngine, DriverPackage>>
}

/** A variable's development value, sent with the batch that maps it and written into `.env` first. */
export interface ProjectVariable {
	name: string
	value: string
}

export interface ProjectConfigResult {
	files: string[]
}

/** What a connection wired into the configuration, by module id. */
interface ConnectionWiring {
	connection: string
	driver: string
	/** The local modules holding its tables, their record naming the connection. */
	modules: { id: string; path: string }[]
	/** Local modules read through the driver whose record names no connection: kept on removal. */
	unrecorded: { id: string; path: string }[]
	/** Whether the driver goes with the connection: it is not the project's own database, nor shared. */
	ownsDriver: boolean
	variable?: string
	/** Every variable supplying the driver's configuration. */
	variables: string[]
}

/** A connection's details as its URL holds them, the password left out. */
interface ConnectionDetails {
	scheme: string
	host: string
	port: string
	database: string
	user: string
	hasPassword: boolean
	options: Record<string, string>
}

export interface ConnectionInfo {
	wiring: ConnectionWiring
	details?: ConnectionDetails
}

