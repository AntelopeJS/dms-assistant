import { z } from "zod";
import type { WireValue } from "../runtime/wire-value";

/** Who wrote a mockup, as `spec.json` names it. */
export type MockupSource = "chat" | "claude-code" | "codex";

/** A mockup of the project, as the popup lists it. */
export interface Mockup {
	/** The directory name under `mockups/`, which `/mockup?name=` opens. */
	name: string;
	/** The spec's title, or the name when it has none. */
	title: string;
	pages: number;
	source?: MockupSource;
	status: "built" | "draft";
	updatedAtMs: number;
	openComments: number;
}

export const MOCKUPS_PATH = "/api/mockup";

const NOT_FOUND = 404;

const RowSchema = z.object({
	name: z.string().min(1),
	title: z.string().optional(),
	pages: z.number().int().nonnegative(),
	openComments: z.number().int().nonnegative(),
	source: z.enum(["chat", "claude-code", "codex"]).optional().catch(undefined),
	updatedAt: z.iso.datetime({ offset: true }),
	status: z.enum(["built", "draft"]),
});

const ListSchema = z.object({ results: z.array(z.unknown()) });

/** `$authFetch` rejects with the HTTP status as `statusCode` and `status`. */
const NotFoundSchema = z.union([
	z.object({ statusCode: z.literal(NOT_FOUND) }),
	z.object({ status: z.literal(NOT_FOUND) }),
]);

function mockupOf(row: unknown): Mockup[] {
	const parsed = RowSchema.safeParse(row);
	if (!parsed.success) return [];
	const { name, title, pages, openComments, source, updatedAt, status } =
		parsed.data;
	return [
		{
			name,
			title: title?.trim() || name,
			pages,
			source,
			status,
			updatedAtMs: Date.parse(updatedAt),
			openComments,
		},
	];
}

/**
 * The project's mockups from `GET /api/mockup` (`{ results, total }`), latest first. A DMS
 * without the route, one older than the mockups or out of development, answers 404, which reads
 * as none; a row of another shape is left out.
 */
export async function listMockups(
	get: (path: string) => Promise<WireValue>,
): Promise<Mockup[]> {
	let body: WireValue;
	try {
		body = await get(MOCKUPS_PATH);
	} catch (error) {
		if (NotFoundSchema.safeParse(error).success) return [];
		throw error;
	}
	const list = ListSchema.safeParse(body);
	if (!list.success) return [];
	return list.data.results
		.flatMap(mockupOf)
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}
