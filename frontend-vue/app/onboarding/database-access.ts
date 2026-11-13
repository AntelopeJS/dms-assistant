import type { DatabaseConnection } from "../../builder/app/runtime/database-types";

/** What a live check of a database connection found. */
export interface DatabaseAccess {
	reachable: boolean;
	latencyMs?: number;
	user?: string;
	canRead: boolean;
	canWrite: boolean;
}

/**
 * Stub for dms-database #157's live privilege check (unmerged), answered from the builder's
 * listed connection, which exists only once the connection is written and the project reloaded:
 * reachable when listed without an error, signed in as its role, read access when reachable,
 * never write access, no latency measured. `null` while the connection is not listed.
 */
export async function checkDatabaseAccess(
	list: () => Promise<DatabaseConnection[]>,
	connection: string,
): Promise<DatabaseAccess | null> {
	const entry = (await list()).find((item) => item.id === connection);
	if (entry === undefined) return null;
	const reachable = entry.error === undefined;
	return {
		reachable,
		user: reachable ? entry.role : undefined,
		canRead: reachable,
		canWrite: false,
	};
}
