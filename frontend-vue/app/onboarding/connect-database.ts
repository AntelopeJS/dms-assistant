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
	fieldProblem,
	managedNames,
	missingField,
	parseConnectionUrl,
	refusalText,
} from "../../builder/app/runtime/database-connect";
import { t } from "../../builder/app/runtime/i18n";
import { checkDatabaseAccess, type DatabaseAccess } from "./database-access";
import { type ConnectCheck, connectChecks } from "./database-checks";

type BuilderApi = ReturnType<typeof useBuilderApi>;

const POLL_MS = 1_000;

/** Where "Connect and analyse" stands: the form, the checks running, or the analysis ready. */
export type ConnectPhase =
	| { kind: "form" }
	| { kind: "checking"; connection: string; module: string }
	| { kind: "analysed"; connection: string; module: string };

/**
 * Why the URL cannot be connected before anything is written: not a URL, no database, no letter
 * or digit to name the connection after, or a problem the builder's own form checks name.
 */
export type UrlProblem =
	| { kind: "unreadable" }
	| { kind: "no-database" }
	| { kind: "no-name" }
	| { kind: "invalid"; message: string };

export interface DatabaseConnect {
	phase: Readonly<Ref<ConnectPhase>>;
	checks: Readonly<Ref<ConnectCheck[]>>;
	/** The refusal of the write, in the module's words. */
	refusal: Readonly<Ref<string | null>>;
	/**
	 * Writes the connection into the project, then follows it until its analysis is ready or a
	 * check fails. It resolves in either case; called again after a failure, it follows the written
	 * connection again instead of writing it twice.
	 */
	connect: (engine: DatabaseEngine, url: string) => Promise<UrlProblem | null>;
}

/**
 * The form the builder's engine writes, the connection named after its database, after the
 * builder form's own checks: the host, the port and the database it can write, a name for the
 * connection, and every field it requires.
 */
export function connectForm(
	engine: DatabaseEngine,
	url: string,
): ConnectForm | UrlProblem {
	let fields: ConnectForm["fields"];
	try {
		fields = parseConnectionUrl(engine, url);
	} catch {
		return { kind: "unreadable" };
	}
	if (fields.database.trim() === "") return { kind: "no-database" };
	const form: ConnectForm = {
		name: fields.database,
		engine,
		fields,
		overrides: {},
	};
	const problem = fieldProblem(fields);
	if (problem !== undefined) return { kind: "invalid", message: problem };
	if (connectionId(form.name) === "") return { kind: "no-name" };
	const missing = missingField(form);
	if (missing !== undefined) {
		return {
			kind: "invalid",
			message: t("database.connect.needs", { missing }),
		};
	}
	return form;
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
	const failure = ref<string | null>(null);
	let reloadingSince: number | undefined;
	let analysing = false;
	let answeredSchemas: string | undefined;
	let written: string | undefined;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	async function analyse(
		connection: string,
		module: string,
		schemas?: string[],
	): Promise<void> {
		analysing = true;
		try {
			const result = await api.analyseDatabase(connection, module, schemas);
			if (!result.ok) failure.value = refusalText(result.error);
		} catch (error) {
			failure.value = api.failure(error).detail;
		} finally {
			analysing = false;
		}
	}

	async function followBuild(
		connection: string,
		module: string,
	): Promise<BuildView> {
		const answers = await readBuild(api, connection);
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
		if (next.schemas && !analysing && next.job !== answeredSchemas) {
			answeredSchemas = next.job;
			await analyse(connection, module, preferredSchemas(next.schemas));
		} else if (next.needsAnalysis && !analysing) {
			await analyse(connection, module);
		}
		return next;
	}

	async function poll(
		connection: string,
		module: string,
		loop: number,
	): Promise<void> {
		let next: BuildView;
		try {
			next = await followBuild(connection, module);
		} catch (error) {
			if (!disposed && loop === generation) {
				failure.value = api.failure(error).detail;
			}
			return;
		}
		if (disposed || loop !== generation) return;
		if (next.fork && next.job) {
			phase.value = { kind: "analysed", connection, module };
			return;
		}
		const stuck =
			next.gaveUp ||
			next.connectionError !== undefined ||
			next.analysisFailed ||
			next.empty ||
			failure.value !== null;
		if (!stuck) {
			timer = setTimeout(() => void poll(connection, module, loop), POLL_MS);
		}
	}

	async function write(
		form: ConnectForm,
		connection: string,
	): Promise<boolean> {
		if (written === connection) return true;
		try {
			const project = await api.projectModules();
			const result = await api.configureProject(
				connectSteps(form, project),
				false,
				connectVariables(form),
			);
			if (!result.ok) {
				refusal.value = refusalText(result.error);
				return false;
			}
		} catch (error) {
			refusal.value = api.failure(error).detail;
			return false;
		}
		written = connection;
		return true;
	}

	async function connect(
		engine: DatabaseEngine,
		url: string,
	): Promise<UrlProblem | null> {
		const form = connectForm(engine, url);
		if ("kind" in form) return form;
		const connection = connectionId(form.name);
		const module = managedNames(form).tablesModule;
		if (timer !== undefined) clearTimeout(timer);
		generation += 1;
		const loop = generation;
		refusal.value = null;
		failure.value = null;
		view.value = null;
		access.value = null;
		reloadingSince = undefined;
		analysing = false;
		answeredSchemas = undefined;
		phase.value = { kind: "checking", connection, module };
		if (!(await write(form, connection))) {
			phase.value = { kind: "form" };
			return null;
		}
		await poll(connection, module, loop);
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
				: connectChecks(view.value, access.value, failure.value),
		),
		refusal,
		connect,
	};
}
