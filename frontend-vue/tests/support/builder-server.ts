import { vi } from "vitest";
import { API_PREFIX } from "../../builder/app/runtime/constants";
import type { DatabaseEngine } from "../../builder/app/runtime/database-engines";
import type {
	AnalysisState,
	DatabaseAccess,
	ProjectModules,
} from "../../builder/app/runtime/database-types";
import type { OpResult } from "../../builder/app/runtime/types";

const PROJECT_PATH = `${API_PREFIX}/database/project`;
const CHECK_PATH = `${API_PREFIX}/database/connections/check`;
const ANALYSIS_PATH = `${API_PREFIX}/database/analysis`;

interface ReadRequest {
	method: "GET";
	query?: { connection?: string };
}

interface CheckRequest {
	method: "POST";
	body: { engine: DatabaseEngine; url: string };
}

type BuilderAnswer = ProjectModules | DatabaseAccess | OpResult<AnalysisState>;

/**
 * The builder's database routes as a test serves them: the code under test builds its own
 * `useBuilderApi` over `useAuthFetch`, so `serve` stubs the authenticated fetch and the error
 * presenter it reads, and every route a suite does not serve refuses.
 */
export function builderServer() {
	const project = vi.fn<() => Promise<ProjectModules>>();
	const check =
		vi.fn<(engine: DatabaseEngine, url: string) => Promise<DatabaseAccess>>();
	const analysis =
		vi.fn<(connection: string) => Promise<OpResult<AnalysisState>>>();

	async function authFetch(
		path: string,
		request: ReadRequest | CheckRequest,
	): Promise<BuilderAnswer> {
		if (request.method === "POST") {
			if (path === CHECK_PATH) {
				return check(request.body.engine, request.body.url);
			}
		} else if (path === PROJECT_PATH) {
			return project();
		} else if (path === ANALYSIS_PATH) {
			return analysis(request.query?.connection ?? "");
		}
		throw new Error(`${request.method} ${path} is not served in the test`);
	}

	return {
		project,
		check,
		analysis,
		serve: (): void => {
			vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
			vi.stubGlobal("useApiErrorPresenter", () => ({
				presentError: () => undefined,
				resolveError: (error: Error) => ({ message: String(error) }),
			}));
		},
		reset: (): void => {
			vi.unstubAllGlobals();
			project.mockReset();
			check.mockReset();
			analysis.mockReset();
		},
	};
}
