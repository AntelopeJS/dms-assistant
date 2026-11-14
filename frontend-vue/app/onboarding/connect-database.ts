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
	 * database, it writes only the new URL. Answers to an attempt that a later `connect`, `reset` or
	 * unmount replaced change nothing.
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
	writing: ConnectionWriting;
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
 * "Connect and analyse" over the builder's live check and connect engine: the check of the URL
 * before anything is written, the `ConfigureProject` batch the builder's form writes with the
 * access chosen, then the builder's build answers polled each second through the project's reload
 * and the analysis, its schemas picked as the builder pre-checks them.
 */
export function useDatabaseConnect(api: BuilderApi): DatabaseConnect {
	const phase = ref<ConnectPhase>({ kind: "form" });
	const view = ref<BuildView | null>(null);
	const access = ref<DatabaseAccess | null>(null);
	const refusal = ref<string | null>(null);
	const failure = ref<string | null>(null);
	let checked: Checked | undefined;
	let reloadingSince: number | undefined;
	let analysing = false;
	let answeredSchemas: string | undefined;
	let written: { connection: string; url: string } | undefined;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	function current(loop: number): boolean {
		return !disposed && loop === generation;
	}

	async function checkAccess(
		engine: DatabaseEngine,
		url: string,
	): Promise<DatabaseAccess> {
		try {
			return await api.checkConnection(engine, url);
		} catch (error) {
			return {
				reachable: false,
				canRead: false,
				canWrite: false,
				reason: api.failure(error).detail,
			};
		}
	}

	async function analyse(
		connection: string,
		module: string,
		loop: number,
		schemas?: string[],
	): Promise<void> {
		analysing = true;
		try {
			const result = await api.analyseDatabase(connection, module, schemas);
			if (!result.ok && current(loop)) {
				failure.value = refusalText(result.error);
			}
		} catch (error) {
			if (current(loop)) failure.value = api.failure(error).detail;
		} finally {
			if (current(loop)) analysing = false;
		}
	}

	async function followBuild(
		connection: string,
		module: string,
		loop: number,
	): Promise<BuildView | null> {
		const answers = await readBuild(api, connection);
		if (!current(loop)) return null;
		const first = buildState(answers);
		reloadingSince = first.reloading
			? (reloadingSince ?? Date.now())
			: undefined;
		const next = buildState(
			answers,
			reloadingSince === undefined ? 0 : Date.now() - reloadingSince,
		);
		view.value = next;
		if (next.schemas && !analysing && next.job !== answeredSchemas) {
			answeredSchemas = next.job;
			await analyse(connection, module, loop, preferredSchemas(next.schemas));
		} else if (next.needsAnalysis && !analysing) {
			await analyse(connection, module, loop);
		}
		return next;
	}

	async function poll(
		connection: string,
		module: string,
		loop: number,
	): Promise<void> {
		let next: BuildView | null;
		try {
			next = await followBuild(connection, module, loop);
		} catch (error) {
			if (current(loop)) failure.value = api.failure(error).detail;
			return;
		}
		if (next === null || !current(loop)) return;
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
		{ form, connection, writing }: Checked,
		choice: ConnectionAccess,
		loop: number,
	): Promise<boolean> {
		const url = connectionUrl(form.engine, form.fields);
		if (written?.connection === connection && written.url === url) return true;
		try {
			const result =
				writing.kind === "url"
					? await api.setConnectionUrl(connection, url)
					: await api.configureProject(
							connectSteps(
								{ ...form, access: choice },
								writing.project,
								writing.driver,
							),
							false,
							connectVariables(form),
						);
			if (!result.ok) {
				if (current(loop)) refusal.value = refusalText(result.error);
				return false;
			}
		} catch (error) {
			if (current(loop)) refusal.value = api.failure(error).detail;
			return false;
		}
		written = { connection, url };
		return true;
	}

	async function proceed(
		target: Checked,
		choice: ConnectionAccess,
		loop: number,
	): Promise<void> {
		const { connection, module } = target;
		phase.value = { kind: "analysing", connection, module };
		if (!(await write(target, choice, loop))) {
			if (current(loop)) phase.value = { kind: "form" };
			return;
		}
		if (current(loop)) await poll(connection, module, loop);
	}

	function stop(): number {
		if (timer !== undefined) clearTimeout(timer);
		generation += 1;
		checked = undefined;
		refusal.value = null;
		failure.value = null;
		view.value = null;
		access.value = null;
		reloadingSince = undefined;
		analysing = false;
		answeredSchemas = undefined;
		return generation;
	}

	async function connect(
		engine: DatabaseEngine,
		url: string,
	): Promise<UrlProblem | null> {
		const form = connectForm(engine, url);
		if ("kind" in form) return form;
		const loop = stop();
		phase.value = { kind: "checking" };
		const answer = await checkAccess(engine, url);
		if (!current(loop)) return null;
		access.value = answer;
		if (!canConnect(answer)) return null;
		const connection = connectionId(form.name);
		const target: Checked = {
			form,
			connection,
			module: managedNames(form).tablesModule,
			writing: { kind: "url" },
		};
		if (written?.connection !== connection) {
			let project: ProjectModules;
			try {
				project = await api.projectModules();
			} catch (error) {
				if (!current(loop)) return null;
				refusal.value = api.failure(error).detail;
				phase.value = { kind: "form" };
				return null;
			}
			if (!current(loop)) return null;
			if (!project.modules.includes(managedNames(form).driverModule)) {
				const driver = project.drivers[engine];
				if (driver === undefined) {
					refusal.value = unavailableReason(engine, project.interfaceDatabase);
					phase.value = { kind: "form" };
					return null;
				}
				target.writing = { kind: "new", project, driver };
				if (answer.canWrite) {
					checked = target;
					phase.value = { kind: "choosing" };
					return null;
				}
			}
		}
		await proceed(target, "read", loop);
		return null;
	}

	async function choose(choice: ConnectionAccess): Promise<void> {
		const target = checked;
		if (target === undefined || phase.value.kind !== "choosing") return;
		checked = undefined;
		await proceed(target, choice, generation);
	}

	function reset(): void {
		stop();
		phase.value = { kind: "form" };
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
				: connectChecks({
						access: access.value,
						connecting:
							phase.value.kind === "analysing" ||
							phase.value.kind === "analysed",
						view: view.value,
						failure: failure.value,
					}),
		),
		refusal,
		connect,
		choose,
		reset,
	};
}
