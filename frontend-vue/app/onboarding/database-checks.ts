import type { BuildView } from "../../builder/app/runtime/database-build";
import type { DatabaseAccess } from "../../builder/app/runtime/database-types";

export type CheckStatus = "pending" | "running" | "done" | "failed";

/** The live checks "Connect and analyse" shows, in order. */
export type ConnectCheck =
	| {
			key: "reachable";
			status: CheckStatus;
			latencyMs?: number;
			error?: string;
			/** The command that installs the engine's driver, when the project lacks it. */
			install?: string;
	  }
	| { key: "signed-in"; status: CheckStatus; user?: string; error?: string }
	| { key: "read"; status: CheckStatus; canWrite?: boolean; error?: string }
	| {
			key: "schema";
			status: CheckStatus;
			problem?: "empty" | "failed" | "gave-up";
			/** The project answers without the connection, so only a restart loads it. */
			restart?: boolean;
			error?: string;
	  };

/** What the checks are drawn from. */
export interface CheckSources {
	/** The answer of the live check, `null` while it runs. */
	access: DatabaseAccess | null;
	/** Whether the connection is being written or was written into the project. */
	connecting: boolean;
	/** The builder's answers once the connection is written, `null` before. */
	view: BuildView | null;
	/** The refusal of the analysis itself, or a request that threw while following it. */
	failure: string | null;
}

/** Whether the live check found a database the DMS can read, so the connection may be written. */
export function canConnect(access: DatabaseAccess): boolean {
	return access.reachable && access.canRead;
}

function failedRead(view: BuildView): string {
	return view.steps.find((step) => step.key === "read")?.detail ?? "";
}

function accessChecks(access: DatabaseAccess | null): ConnectCheck[] {
	if (access === null) {
		return [
			{ key: "reachable", status: "running" },
			{ key: "signed-in", status: "pending" },
			{ key: "read", status: "pending" },
		];
	}
	if (!access.reachable) {
		return [
			{
				key: "reachable",
				status: "failed",
				error: access.reason,
				install: access.install?.command,
			},
			{ key: "signed-in", status: "pending" },
			{ key: "read", status: "pending" },
		];
	}
	const reachable: ConnectCheck = {
		key: "reachable",
		status: "done",
		latencyMs: access.latencyMs,
	};
	if (access.latencyMs === undefined) {
		return [
			reachable,
			{ key: "signed-in", status: "failed", error: access.reason },
			{ key: "read", status: "pending" },
		];
	}
	return [
		reachable,
		{ key: "signed-in", status: "done", user: access.user },
		access.canRead
			? { key: "read", status: "done", canWrite: access.canWrite }
			: { key: "read", status: "failed", error: access.reason },
	];
}

function schemaCheck({
	view,
	connecting,
	failure,
}: CheckSources): ConnectCheck {
	if (view?.gaveUp) {
		return { key: "schema", status: "failed", problem: "gave-up" };
	}
	if (view?.connectionError !== undefined) {
		return {
			key: "schema",
			status: "failed",
			problem: "failed",
			error: view.connectionError,
		};
	}
	if (failure !== null) {
		return {
			key: "schema",
			status: "failed",
			problem: "failed",
			error: failure,
		};
	}
	if (view?.restartNeeded) {
		return { key: "schema", status: "running", restart: true };
	}
	if (view === null || view.reload !== undefined) {
		return { key: "schema", status: connecting ? "running" : "pending" };
	}
	if (view.analysisFailed) {
		return {
			key: "schema",
			status: "failed",
			problem: "failed",
			error: failedRead(view),
		};
	}
	if (view.empty) return { key: "schema", status: "failed", problem: "empty" };
	return { key: "schema", status: view.fork ? "done" : "running" };
}

/**
 * The checks as the live check and the builder's answers stand: the live check reaches the
 * server, signs in and reads, all before anything is written; then the connection is written and
 * the analysis reads the schema. The schema check waits while the database cannot be read.
 */
export function connectChecks(sources: CheckSources): ConnectCheck[] {
	const { access } = sources;
	return [
		...accessChecks(access),
		access !== null && canConnect(access)
			? schemaCheck(sources)
			: { key: "schema", status: "pending" },
	];
}
