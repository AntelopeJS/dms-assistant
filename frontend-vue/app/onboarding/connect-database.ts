import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import type { useBuilderApi } from "../../builder/app/runtime/api";
import {
	type BuildView,
	buildState,
	preferredSchemas,
	readBuild,
} from "../../builder/app/runtime/database-build";
import {
	type ConnectForm,
	connectSteps,
	connectVariables,
	connectionId,
	type DatabaseEngine,
	managedNames,
	parseConnectionUrl,
	refusalText,
} from "../../builder/app/runtime/database-connect";
import { checkDatabaseAccess, type DatabaseAccess } from "./database-access";
import { type ConnectCheck, connectChecks } from "./database-checks";

type BuilderApi = ReturnType<typeof useBuilderApi>;

const POLL_MS = 1_000;

/** Where "Connect and analyse" stands: the form, the checks running, or the analysis ready. */
export type ConnectPhase =
	| { kind: "form" }
	| { kind: "checking"; connection: string; module: string }
	| { kind: "analysed"; connection: string; module: string };

/** Why the URL cannot be connected before anything is written. */
export type UrlProblem = "unreadable" | "no-database";

export interface DatabaseConnect {
	phase: Readonly<Ref<ConnectPhase>>;
	checks: Readonly<Ref<ConnectCheck[]>>;
	/** The refusal of the write, in the module's words. */
	refusal: Readonly<Ref<string | null>>;
	/** Writes the connection into the project, then follows it until its analysis is ready. */
	connect: (engine: DatabaseEngine, url: string) => Promise<UrlProblem | null>;
}

/** The form the builder's engine writes, the connection named after its database. */
export function connectForm(
	engine: DatabaseEngine,
	url: string,
): ConnectForm | UrlProblem {
	let fields: ConnectForm["fields"];
	try {
		fields = parseConnectionUrl(engine, url);
	} catch {
		return "unreadable";
	}
	if (fields.database.trim() === "") return "no-database";
	return { name: fields.database, engine, fields, overrides: {} };
}

/**
 * "Connect and analyse" over the builder's connect engine: the `ConfigureProject` batch the
 * builder's form writes, then the builder's build answers polled each second through the project's
 * reload, the access check, and the analysis, its schemas picked as the builder pre-checks them.
 */
export function useDatabaseConnect(api: BuilderApi): DatabaseConnect {
	const phase = ref<ConnectPhase>({ kind: "form" });
	const view = ref<BuildView | null>(null);
	const access = ref<DatabaseAccess | null>(null);
	const refusal = ref<string | null>(null);
	let reloadingSince: number | undefined;
	let analysing = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	async function analyse(
		connection: string,
		module: string,
		schemas?: string[],
	): Promise<void> {
		analysing = true;
		const result = await api.analyseDatabase(connection, module, schemas);
		if (!result.ok) refusal.value = refusalText(result.error);
	}

	async function poll(connection: string, module: string): Promise<void> {
		const answers = await readBuild(api, connection);
		if (disposed) return;
		const first = buildState(answers);
		reloadingSince = first.reloading
			? (reloadingSince ?? Date.now())
			: undefined;
		const next = buildState(
			answers,
			reloadingSince === undefined ? 0 : Date.now() - reloadingSince,
		);
		view.value = next;
		const listed = !next.reloading && next.connectionError === undefined;
		if (listed && access.value === null) {
			access.value = await checkDatabaseAccess(
				api.databaseConnections,
				connection,
			).catch(() => null);
		}
		if (next.schemas && !analysing) {
			await analyse(connection, module, preferredSchemas(next.schemas));
		} else if (next.needsAnalysis && !analysing) {
			await analyse(connection, module);
		}
		if (next.fork && next.job) {
			phase.value = { kind: "analysed", connection, module };
			return;
		}
		const stuck =
			next.gaveUp ||
			next.connectionError !== undefined ||
			next.analysisFailed ||
			next.empty ||
			refusal.value !== null;
		if (!disposed && !stuck) {
			timer = setTimeout(() => void poll(connection, module), POLL_MS);
		}
	}

	async function connect(
		engine: DatabaseEngine,
		url: string,
	): Promise<UrlProblem | null> {
		const form = connectForm(engine, url);
		if (typeof form === "string") return form;
		const connection = connectionId(form.name);
		const module = managedNames(form).tablesModule;
		refusal.value = null;
		view.value = null;
		access.value = null;
		analysing = false;
		phase.value = { kind: "checking", connection, module };
		try {
			const project = await api.projectModules();
			const result = await api.configureProject(
				connectSteps(form, project),
				false,
				connectVariables(form),
			);
			if (!result.ok) {
				refusal.value = refusalText(result.error);
				phase.value = { kind: "form" };
				return null;
			}
		} catch (error) {
			refusal.value = api.failure(error).detail;
			phase.value = { kind: "form" };
			return null;
		}
		await poll(connection, module);
		return null;
	}

	onBeforeUnmount(() => {
		disposed = true;
		if (timer !== undefined) clearTimeout(timer);
	});

	return {
		phase,
		checks: computed(() =>
			phase.value.kind === "form"
				? []
				: connectChecks(view.value, access.value),
		),
		refusal,
		connect,
	};
}
