/** A mockup of the project, as the popup lists it. */
export interface Mockup {
	id: string;
	title: string;
	pages: number;
	/** Who made it: "Claude Code", "the chat". */
	source?: string;
	status: "built" | "draft";
	updatedAtMs: number;
	openComments?: number;
}

export const MOCKUPS_PATH = "/api/mockup";

const NOT_FOUND = 404;

/** `$authFetch` rejects with the HTTP status as `statusCode` and `status`. */
function isNotFound(error: unknown): boolean {
	if (error === null || typeof error !== "object") return false;
	return (
		Reflect.get(error, "statusCode") === NOT_FOUND ||
		Reflect.get(error, "status") === NOT_FOUND
	);
}

function isMockup(value: unknown): value is Mockup {
	if (value === null || typeof value !== "object") return false;
	const status = Reflect.get(value, "status");
	return (
		typeof Reflect.get(value, "id") === "string" &&
		typeof Reflect.get(value, "title") === "string" &&
		typeof Reflect.get(value, "pages") === "number" &&
		(status === "built" || status === "draft") &&
		typeof Reflect.get(value, "updatedAtMs") === "number"
	);
}

/**
 * Stub for dms #858 (unmerged): the project's mockups from `GET /api/mockup`, latest first. A DMS
 * without the route answers 404, which reads as none; an entry of another shape is left out.
 */
export async function listMockups(
	get: (path: string) => Promise<unknown>,
): Promise<Mockup[]> {
	try {
		const body = await get(MOCKUPS_PATH);
		const entries = Array.isArray(body) ? body.filter(isMockup) : [];
		return entries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
	} catch (error) {
		if (isNotFound(error)) return [];
		throw error;
	}
}
