import * as z from "zod/mini";
import type { ToolCallMessage } from "../types/conversation";
import { bareToolName } from "./tool-lexicon";

const PAGE_VERIFY_TOOL = "page_verify";
const FAILURE_SEPARATOR = ": ";

/**
 * The part of the DMS's `page_verify` report the build dialog reads: whether
 * every page passed, and each failed check by page.
 */
const PageVerifyReportSchema = z.object({
	ok: z.boolean(),
	pages: z.array(
		z.object({
			page: z.string(),
			ok: z.boolean(),
			failures: z.array(z.string()),
		}),
	),
});

const TextBlockSchema = z.object({ type: z.literal("text"), text: z.string() });

export interface PageVerifyResult {
	ok: boolean;
	/** One line per failed check: `/rentals: the table drew no rows`. */
	failures: string[];
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * The JSON the tool answered, as a live call carries it (MCP content blocks)
 * or a stored transcript does (the same blocks, or the parsed report).
 */
function candidatesOf(result: unknown): unknown[] {
	if (typeof result === "string") return [parseJson(result)];
	if (!Array.isArray(result)) return [result];
	return result.flatMap((block) => {
		const text = TextBlockSchema.safeParse(block);
		return text.success ? [parseJson(text.data.text)] : [block];
	});
}

function readReport(tool: ToolCallMessage): PageVerifyResult | null {
	for (const candidate of candidatesOf(tool.result)) {
		const report = PageVerifyReportSchema.safeParse(candidate);
		if (!report.success) continue;
		return {
			ok: report.data.ok,
			failures: report.data.pages.flatMap((page) =>
				page.failures.map(
					(failure) => `${page.page}${FAILURE_SEPARATOR}${failure}`,
				),
			),
		};
	}
	return null;
}

/** The result of the last `page_verify` call among `calls` that answered a report. */
export function lastPageVerify(
	calls: readonly ToolCallMessage[],
): PageVerifyResult | null {
	for (let index = calls.length - 1; index >= 0; index -= 1) {
		const call = calls[index];
		if (bareToolName(call.toolName) !== PAGE_VERIFY_TOOL) continue;
		const report = readReport(call);
		if (report !== null) return report;
	}
	return null;
}
