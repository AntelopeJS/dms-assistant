import { API_PREFIX } from './constants'
import type { DatabaseEngine } from './database-connect'
import type {
	AnalysisState,
	ConnectionInfo,
	DatabaseAccess,
	DatabaseConnection,
	MappedRelation,
	MapResourcesInput,
	MapResourcesResult,
	ProjectConfigResult,
	ProjectConfigStep,
	ProjectModules,
	ProjectVariable,
} from './database-types'
import { OWNER_UI_HEADERS } from './owner-ui'
import type { BuilderError, OpResult } from './types'

/**
 * The typed client over the module's database routes. Plain reads answer with
 * their value; writes, and the reads the module answers with an `OpResult`,
 * answer with one the caller branches on — a request that failed outright
 * included.
 */
export function useBuilderApi() {
	const { $authFetch } = useAuthFetch()
	const { presentError, resolveError } = useApiErrorPresenter()

	function failure(error: unknown): Extract<BuilderError, { code: 'unsupported' }> {
		const options = { fallbackKey: 'error.500.description' }
		const notice = resolveError(error, options)
		presentError(error, options)
		return { code: 'unsupported', detail: notice?.message ?? '' }
	}

	function get<T>(path: string, query?: Record<string, string>): Promise<T> {
		return $authFetch<T>(`${API_PREFIX}${path}`, { method: 'GET', query })
	}

	function answered<T>(request: Promise<OpResult<T>>): Promise<OpResult<T>> {
		return request.catch((error: unknown) => ({ ok: false, error: failure(error) }))
	}

	function read<T>(
		path: string,
		query: Record<string, string>,
	): Promise<OpResult<T>> {
		return answered(get<OpResult<T>>(path, query))
	}

	function post<T>(
		path: string,
		body: object,
	): Promise<OpResult<T>> {
		return answered(
			$authFetch<OpResult<T>>(`${API_PREFIX}${path}`, { method: 'POST', body, headers: OWNER_UI_HEADERS }),
		)
	}

	return {
		failure,
		databaseConnections: () => get<DatabaseConnection[]>('/database/connections'),
		/**
		 * Connects to the URL live and answers what its account may do, writing nothing. The module
		 * answers in development only; a URL of another engine is refused with a 400.
		 */
		checkConnection: (engine: DatabaseEngine, url: string) =>
			$authFetch<DatabaseAccess>(`${API_PREFIX}/database/connections/check`, {
				method: 'POST',
				body: { engine, url },
				headers: OWNER_UI_HEADERS,
			}),
		analyseDatabase: (connection: string, module: string, schemas?: string[]) =>
			post<AnalysisState>('/database/analyse', { connection, module, schemas }),
		analysis: (id: string) => read<AnalysisState>('/database/analysis', { id }),
		/** The connection's latest analysis; a connection never analysed is answered 404. */
		latestAnalysis: (connection: string) => get<OpResult<AnalysisState>>('/database/analysis', { connection }),
		/** The relations the module maps for the connection, as their current choices. */
		mapping: (connection: string, module: string) =>
			read<MappedRelation[]>('/database/mapping', { connection, module }),
		mapDatabase: (input: MapResourcesInput) =>
			post<MapResourcesResult>('/database/map', input),
		/** The ids of the modules the project's configuration lists. */
		projectModules: () => get<ProjectModules>('/database/project'),
		/**
		 * Applies the steps, or answers their diff on a dry run. The variables' values go into the
		 * project's `.env` before the configuration is written; the answer never carries them back.
		 */
		configureProject: (steps: ProjectConfigStep[], dryRun: boolean, variables?: ProjectVariable[]) =>
			post<ProjectConfigResult>('/database/project', { steps, opts: { dryRun }, variables }),
		/** What the connection wired into the configuration, and its details without the password. */
		databaseConnection: (connection: string) =>
			get<ConnectionInfo>('/database/connection', { connection }),
		/** Takes the connection out of the project, with its tables module and that module's folder. */
		removeConnection: (connection: string, opts: { dryRun: boolean }) =>
			post<ProjectConfigResult>('/database/connection/remove', { connection, ...opts }),
		/** Writes the connection's new URL into `.env`; one with no password keeps the current one. */
		setConnectionUrl: (connection: string, url: string) =>
			post<{ variable: string }>('/database/connection/url', { connection, url }),
		/** Whether the project's `.env` changed since the running project loaded it: a restart is due to load it. */
		reloadDue: () => get<{ due: boolean }>('/database/reload'),
	}
}
