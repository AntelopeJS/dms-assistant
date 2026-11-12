import type { BuildView } from "../../builder/app/runtime/database-build";
import type { DatabaseAccess } from "./database-access";

export type CheckStatus = "pending" | "running" | "done" | "failed";

/** The live checks "Connect and analyse" shows, in order. */
export type ConnectCheck =
	| {
			key: "reachable";
			status: CheckStatus;
			latencyMs?: number;
			error?: string;
	  }
	| { key: "signed-in"; status: CheckStatus; user?: string }
	| { key: "read"; status: CheckStatus }
	| {
			key: "schema";
			status: CheckStatus;
			problem?: "empty" | "failed" | "gave-up";
			error?: string;
	  };

function failedRead(view: BuildView): string {
	return view.steps.find((step) => step.key === "read")?.detail ?? "";
}

function schemaCheck(view: BuildView): ConnectCheck {
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
 * The checks as the builder's answers and the access check stand: the server is reached once the
 * project lists the connection, then the access check names the user and its read access, then
 * the analysis reads the schema. `view` is `null` while the connection is being written.
 */
export function connectChecks(
	view: BuildView | null,
	access: DatabaseAccess | null,
): ConnectCheck[] {
	const waiting: ConnectCheck[] = [
		{ key: "signed-in", status: "pending" },
		{ key: "read", status: "pending" },
		{ key: "schema", status: "pending" },
	];
	if (view?.gaveUp) {
		return [
			{ key: "reachable", status: "failed" },
			{ key: "signed-in", status: "pending" },
			{ key: "read", status: "pending" },
			{ key: "schema", status: "failed", problem: "gave-up" },
		];
	}
	if (view?.connectionError !== undefined) {
		return [
			{ key: "reachable", status: "failed", error: view.connectionError },
			...waiting,
		];
	}
	if (view === null || view.reloading || access === null) {
		return [{ key: "reachable", status: "running" }, ...waiting];
	}
	if (!access.reachable) {
		return [{ key: "reachable", status: "failed" }, ...waiting];
	}
	return [
		{ key: "reachable", status: "done", latencyMs: access.latencyMs },
		{ key: "signed-in", status: "done", user: access.user },
		{ key: "read", status: access.canRead ? "done" : "failed" },
		access.canRead ? schemaCheck(view) : { key: "schema", status: "pending" },
	];
}
