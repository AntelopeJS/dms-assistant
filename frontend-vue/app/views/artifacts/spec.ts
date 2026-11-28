import { z } from "zod";

/**
 * What an artifact holds, as the sidecar's `sidecar/src/artifacts/spec.ts`
 * defines it; this is the dashboard's mirror. Every object is strict and every
 * text bounded, and the view draws a stored artifact only once it passes: a
 * key the schema does not name, a block type it does not draw or markup in
 * place of data never reaches a template. Texts are shown as text, never
 * parsed as HTML.
 */
const LIMITS = {
	TITLE_CHARS: 120,
	SUMMARY_CHARS: 600,
	TEXT_CHARS: 200,
	PARAGRAPH_CHARS: 4000,
	CELL_CHARS: 400,
	LABEL_CHARS: 80,
	BLOCKS: 40,
	KPIS: 8,
	COLUMNS: 20,
	ROWS: 500,
	LIST_ITEMS: 100,
	SERIES: 6,
	POINTS: 200,
} as const;

export const ARTIFACT_TONES = [
	"neutral",
	"success",
	"warning",
	"error",
	"info",
] as const;
export type ArtifactTone = (typeof ARTIFACT_TONES)[number];

function text(maxChars: number) {
	return z.string().trim().min(1).max(maxChars);
}

const CellSchema = z.union([
	z.string().max(LIMITS.CELL_CHARS),
	z.number().finite(),
	z.boolean(),
	z.null(),
]);

const HeadingBlockSchema = z.strictObject({
	type: z.literal("heading"),
	text: text(LIMITS.TEXT_CHARS),
});

const ParagraphBlockSchema = z.strictObject({
	type: z.literal("paragraph"),
	text: text(LIMITS.PARAGRAPH_CHARS),
});

const ListBlockSchema = z.strictObject({
	type: z.literal("list"),
	ordered: z.boolean().optional(),
	items: z.array(text(LIMITS.CELL_CHARS)).min(1).max(LIMITS.LIST_ITEMS),
});

const KpiSchema = z.strictObject({
	label: text(LIMITS.TEXT_CHARS),
	value: z.union([text(LIMITS.LABEL_CHARS), z.number().finite()]),
	detail: text(LIMITS.TEXT_CHARS).optional(),
	tone: z.enum(ARTIFACT_TONES).optional(),
});

const KpisBlockSchema = z.strictObject({
	type: z.literal("kpis"),
	items: z.array(KpiSchema).min(1).max(LIMITS.KPIS),
});

const TableColumnSchema = z.strictObject({
	label: text(LIMITS.LABEL_CHARS),
	align: z.enum(["left", "right"]).optional(),
});

const TableBlockSchema = z.strictObject({
	type: z.literal("table"),
	caption: text(LIMITS.TEXT_CHARS).optional(),
	columns: z.array(TableColumnSchema).min(1).max(LIMITS.COLUMNS),
	rows: z.array(z.array(CellSchema).max(LIMITS.COLUMNS)).max(LIMITS.ROWS),
});

const ChartSeriesSchema = z.strictObject({
	name: text(LIMITS.LABEL_CHARS),
	data: z.array(z.number().finite()).min(1).max(LIMITS.POINTS),
});

const ChartBlockSchema = z
	.strictObject({
		type: z.literal("chart"),
		kind: z.enum(["bar", "line"]),
		title: text(LIMITS.TEXT_CHARS).optional(),
		categories: z
			.array(z.string().max(LIMITS.LABEL_CHARS))
			.min(1)
			.max(LIMITS.POINTS),
		series: z.array(ChartSeriesSchema).min(1).max(LIMITS.SERIES),
	})
	.refine(
		(chart) =>
			chart.series.every(
				(series) => series.data.length === chart.categories.length,
			),
		{ message: "each series needs one value per category" },
	);

const ArtifactBlockSchema = z.discriminatedUnion("type", [
	HeadingBlockSchema,
	ParagraphBlockSchema,
	ListBlockSchema,
	KpisBlockSchema,
	TableBlockSchema,
	ChartBlockSchema,
]);

export const ArtifactSpecSchema = z.strictObject({
	title: text(LIMITS.TITLE_CHARS),
	summary: text(LIMITS.SUMMARY_CHARS).optional(),
	blocks: z.array(ArtifactBlockSchema).min(1).max(LIMITS.BLOCKS),
});

export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;
export type ArtifactBlock = z.infer<typeof ArtifactBlockSchema>;
export type ArtifactCell = z.infer<typeof CellSchema>;
export type KpiItem = z.infer<typeof KpiSchema>;
export type TableBlock = z.infer<typeof TableBlockSchema>;
export type ChartBlock = z.infer<typeof ChartBlockSchema>;

/** The artifact's data when it is a shape the view draws, else null. */
export function parseArtifactSpec(value: unknown): ArtifactSpec | null {
	const parsed = ArtifactSpecSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
