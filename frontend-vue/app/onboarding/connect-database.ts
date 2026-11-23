import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import type { useBuilderApi } from "../../builder/app/runtime/api";
import {
	type BuildView,
	buildState,
	preferredSchemas,
	type Reload,
	readBuild,
} from "../../builder/app/runtime/database-build";
import {
	type ConnectForm,
	type ConnectionAccess,
	connectSteps,
	connectVariables,
	connectionId,
	connectionUrl,
	type DatabaseEngine,
	ENGINES,
	fieldProblem,
	managedNames,
	missingField,
	parseConnectionUrl,
	refusalText,
	unavailableReason,
} from "../../builder/app/runtime/database-connect";
import type {
	DatabaseAccess,
	DriverPackage,
	ProjectModules,
} from "../../builder/app/runtime/database-types";
import { t } from "../../builder/app/runtime/i18n";
import { type AnalysisLead, tabAnalysisLead } from "./analysis-lead";
import type { ConnectMemory, RememberedConnection } from "./connect-memory";
import {
	canConnect,
	type ConnectCheck,
	connectChecks,
} from "./database-checks";

type BuilderApi = ReturnType<typeof useBuilderApi>;

/** The engines the builder connects, the ones its live check accepts, in the order it lists them. */
export const CONNECTABLE_ENGINES = Object.keys(ENGINES).filter(
	(engine): engine is DatabaseEngine => Object.hasOwn(ENGINES, engine),
);

export function engineNames(locale: string): string {
	return new Intl.ListFormat(locale, { type: "disjunction" }).format(
		CONNECTABLE_ENGINES.map((engine) => ENGINES[engine].label),
	);
}

const POLL_MS = 1_000;

/** The generation of the follow a remembered connection starts; every `connect` or `reset` moves past it. */
const RESUMED_LOOP = 0;

/**
 * Where "Connect and analyse" stands: the form, the live check (which a failed check ends in),
 * the access to give a database the account can write to, then the connection written and
 * analysed.
 */
export type ConnectPhase =
	| { kind: "form" }
	| { kind: "checking" }
	| { kind: "choosing" }
	| { kind: "analysing"; connection: string; module: string }
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
	 * Checks the URL live, writing nothing. A database the account cannot read stops there. A new
	 * connection whose account can write waits in `choosing` for `choose`; any other is written
	 * read-only, or keeps the access an earlier visit wrote, then followed until its analysis is
	 * ready or a check fails. It resolves in every case. Called again after a failure with the same
	 * URL, it follows the written connection again without writing; with another URL for the same
	 * database, it writes only the new URL, and follows the connection once the project loaded it. Answers to an attempt that a later `connect`, `reset` or
	 * unmount replaced change nothing. The connection written, even after an unmount, is remembered
	 * until its analysis is ready, the project's connection or analysis fails, the database has no
	 * table, the project no longer declares it, its time to be followed again runs out, or a later
	 * `connect` or `reset` in any popup of the tab; the next `useDatabaseConnect` follows it again.
	 */
	connect: (engine: DatabaseEngine, url: string) => Promise<UrlProblem | null>;
	/** Writes the connection checked in `choosing` with this access, then follows it. */
	choose: (access: ConnectionAccess) => Promise<void>;
	/** Back to the form, from `choosing` or a failed check. */
	reset: () => void;
}

type ConnectionWriting =
	| { kind: "url" }
	| { kind: "new"; project: ProjectModules; driver: DriverPackage };

interface Checked {
	form: ConnectForm;
	connection: string;
	module: string;
	access: DatabaseAccess;
	writing: ConnectionWriting;
	/** The memory's attempt this connect began. */
	attempt: string;
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

interface Generation {
	loop: number;
	attempt: string;
}

/** What one popup's connect flow tracks while it checks, writes and follows a connection. */
interface Connector {
	api: BuilderApi;
	memory: ConnectMemory;
	lead: AnalysisLead;
	resumeUntil: number | undefined;
	phase: Ref<ConnectPhase>;
	view: Ref<BuildView | null>;
	access: Ref<DatabaseAccess | null>;
	refusal: Ref<string | null>;
	failure: Ref<string | null>;
	checked: Checked | undefined;
	reloadingSince: { reload: Reload; at: number } | undefined;
	isAnalysing: boolean;
	answeredSchemas: string | undefined;
	written: { connection: string; url: string } | undefined;
	generation: number;
	timer: ReturnType<typeof setTimeout> | undefined;
	isDisposed: boolean;
}

function isCurrent(c: Connector, loop: number): boolean {
	return !c.isDisposed && loop === c.generation;
}

async function leads(
	c: Connector,
	connection: string,
	loop: number,
): Promise<boolean> {
	return (await c.lead.take(connection)) && isCurrent(c, loop);
}

async function checkAccess(
	c: Connector,
	engine: DatabaseEngine,
	url: string,
): Promise<DatabaseAccess> {
	try {
		return await c.api.checkConnection(engine, url);
	} catch (error) {
		return {
			reachable: false,
			canRead: false,
			canWrite: false,
			reason: c.api.failure(error).detail,
		};
	}
}

async function analyse(
	c: Connector,
	connection: string,
	module: string,
	loop: number,
	schemas?: string[],
): Promise<void> {
	c.isAnalysing = true;
	try {
		const result = await c.api.analyseDatabase(connection, module, schemas);
		if (!result.ok && isCurrent(c, loop)) {
			c.failure.value = refusalText(result.error);
		}
	} catch (error) {
		if (isCurrent(c, loop)) c.failure.value = c.api.failure(error).detail;
	} finally {
		if (isCurrent(c, loop)) c.isAnalysing = false;
	}
}

async function followBuild(
	c: Connector,
	connection: string,
	module: string,
	loop: number,
): Promise<BuildView | null> {
	const answers = await readBuild(c.api, connection);
	if (!isCurrent(c, loop)) return null;
	const { reload } = buildState(answers);
	if (reload === undefined) c.reloadingSince = undefined;
	else if (c.reloadingSince?.reload !== reload) {
		c.reloadingSince = { reload, at: Date.now() };
	}
	const next = buildState(
		answers,
		c.reloadingSince === undefined ? 0 : Date.now() - c.reloadingSince.at,
	);
	c.view.value = next;
	if (next.schemas && !c.isAnalysing && next.job !== c.answeredSchemas) {
		if (!(await leads(c, connection, loop))) return next;
		c.answeredSchemas = next.job;
		await analyse(c, connection, module, loop, preferredSchemas(next.schemas));
	} else if (
		next.needsAnalysis &&
		!c.isAnalysing &&
		(await leads(c, connection, loop))
	) {
		await analyse(c, connection, module, loop);
	}
	return next;
}

async function keepsFollowing(
	c: Connector,
	connection: string,
	module: string,
	loop: number,
): Promise<boolean> {
	let next: BuildView | null;
	try {
		next = await followBuild(c, connection, module, loop);
	} catch (error) {
		if (isCurrent(c, loop)) c.failure.value = c.api.failure(error).detail;
		return false;
	}
	if (next === null || !isCurrent(c, loop)) return false;
	const expired =
		loop === RESUMED_LOOP &&
		c.resumeUntil !== undefined &&
		Date.now() >= c.resumeUntil;
	if (next.undeclared || expired) {
		c.memory.clear();
		c.phase.value = { kind: "form" };
		return false;
	}
	if (next.fork && next.job) {
		c.memory.clear();
		c.phase.value = { kind: "analysed", connection, module };
		return false;
	}
	if (
		next.connectionError !== undefined ||
		next.analysisFailed ||
		next.empty ||
		next.allMapped
	) {
		c.memory.clear();
		return false;
	}
	return !next.gaveUp && c.failure.value === null;
}

async function poll(
	c: Connector,
	connection: string,
	module: string,
	loop: number,
): Promise<void> {
	if (await keepsFollowing(c, connection, module, loop)) {
		c.timer = setTimeout(() => void poll(c, connection, module, loop), POLL_MS);
	} else if (isCurrent(c, loop)) {
		c.lead.release();
	}
}

async function write(
	c: Connector,
	{ form, connection, writing }: Checked,
	choice: ConnectionAccess,
	loop: number,
): Promise<boolean> {
	const url = connectionUrl(form.engine, form.fields);
	if (c.written?.connection === connection && c.written.url === url)
		return true;
	try {
		const result =
			writing.kind === "url"
				? await c.api.setConnectionUrl(connection, url)
				: await c.api.configureProject(
						connectSteps(
							{ ...form, access: choice },
							writing.project,
							writing.driver,
						),
						false,
						connectVariables(form),
					);
		if (!result.ok) {
			if (isCurrent(c, loop)) c.refusal.value = refusalText(result.error);
			return false;
		}
	} catch (error) {
		if (isCurrent(c, loop)) c.refusal.value = c.api.failure(error).detail;
		return false;
	}
	c.written = { connection, url };
	return true;
}

async function proceed(
	c: Connector,
	target: Checked,
	choice: ConnectionAccess,
	loop: number,
): Promise<void> {
	const { form, connection, module, access: answer } = target;
	c.phase.value = { kind: "analysing", connection, module };
	if (!(await write(c, target, choice, loop))) {
		if (isCurrent(c, loop)) c.phase.value = { kind: "form" };
		return;
	}
	c.memory.write(target.attempt, {
		engine: form.engine,
		connection,
		access: answer,
	});
	if (isCurrent(c, loop)) await poll(c, connection, module, loop);
}

/** Drops everything the earlier attempt knew, and starts the next generation of attempts. */
function supersede(c: Connector): Generation {
	if (c.timer !== undefined) clearTimeout(c.timer);
	c.lead.release();
	c.generation += 1;
	const attempt = c.memory.begin();
	c.checked = undefined;
	c.refusal.value = null;
	c.failure.value = null;
	c.view.value = null;
	c.access.value = null;
	c.reloadingSince = undefined;
	c.isAnalysing = false;
	c.answeredSchemas = undefined;
	return { loop: c.generation, attempt };
}

async function connect(
	c: Connector,
	engine: DatabaseEngine,
	url: string,
): Promise<UrlProblem | null> {
	const form = connectForm(engine, url);
	if ("kind" in form) return form;
	const { loop, attempt } = supersede(c);
	c.phase.value = { kind: "checking" };
	const answer = await checkAccess(c, engine, url);
	if (!isCurrent(c, loop)) return null;
	c.access.value = answer;
	if (!canConnect(answer)) return null;
	const connection = connectionId(form.name);
	const target: Checked = {
		form,
		connection,
		module: managedNames(form).tablesModule,
		access: answer,
		writing: { kind: "url" },
		attempt,
	};
	if (c.written?.connection !== connection) {
		let project: ProjectModules;
		try {
			project = await c.api.projectModules();
		} catch (error) {
			if (!isCurrent(c, loop)) return null;
			c.refusal.value = c.api.failure(error).detail;
			c.phase.value = { kind: "form" };
			return null;
		}
		if (!isCurrent(c, loop)) return null;
		if (!project.modules.includes(managedNames(form).driverModule)) {
			const driver = project.drivers[engine];
			if (driver === undefined) {
				c.refusal.value = unavailableReason(engine, project.interfaceDatabase);
				c.phase.value = { kind: "form" };
				return null;
			}
			target.writing = { kind: "new", project, driver };
			if (answer.canWrite) {
				c.checked = target;
				c.phase.value = { kind: "choosing" };
				return null;
			}
		}
	}
	await proceed(c, target, "read", loop);
	return null;
}

async function choose(c: Connector, choice: ConnectionAccess): Promise<void> {
	const target = c.checked;
	if (target === undefined || c.phase.value.kind !== "choosing") return;
	c.checked = undefined;
	await proceed(c, target, choice, c.generation);
}

function reset(c: Connector): void {
	supersede(c);
	c.phase.value = { kind: "form" };
}

function createConnector(
	api: BuilderApi,
	memory: ConnectMemory,
	remembered: RememberedConnection | null,
): Connector {
	return {
		api,
		memory,
		lead: tabAnalysisLead(),
		resumeUntil: remembered?.until,
		phase: ref<ConnectPhase>(
			remembered === null
				? { kind: "form" }
				: {
						kind: "analysing",
						connection: remembered.connection,
						module: remembered.module,
					},
		),
		view: ref<BuildView | null>(null),
		access: ref<DatabaseAccess | null>(remembered?.access ?? null),
		refusal: ref<string | null>(null),
		failure: ref<string | null>(null),
		checked: undefined,
		reloadingSince: undefined,
		isAnalysing: false,
		answeredSchemas: undefined,
		written: undefined,
		generation: RESUMED_LOOP,
		timer: undefined,
		isDisposed: false,
	};
}

/**
 * "Connect and analyse" over the builder's live check and connect engine: the check of the URL
 * before anything is written, the `ConfigureProject` batch the builder's form writes with the
 * access chosen, then the builder's build answers polled each second through the project's reload
 * and the analysis, its schemas picked as the builder pre-checks them. A connection `memory` holds
 * is followed again from the start, without its URL.
 */
export function useDatabaseConnect(
	api: BuilderApi,
	memory: ConnectMemory,
): DatabaseConnect {
	const remembered = memory.read();
	const c = createConnector(api, memory, remembered);
	onBeforeUnmount(() => {
		c.isDisposed = true;
		if (c.timer !== undefined) clearTimeout(c.timer);
		c.lead.release();
	});
	if (remembered !== null) {
		void poll(c, remembered.connection, remembered.module, RESUMED_LOOP);
	}
	return {
		phase: c.phase,
		checks: computed(() =>
			c.phase.value.kind === "form"
				? []
				: connectChecks({
						access: c.access.value,
						connecting:
							c.phase.value.kind === "analysing" ||
							c.phase.value.kind === "analysed",
						view: c.view.value,
						failure: c.failure.value,
					}),
		),
		refusal: c.refusal,
		connect: (engine, url) => connect(c, engine, url),
		choose: (choice) => choose(c, choice),
		reset: () => reset(c),
	};
}
