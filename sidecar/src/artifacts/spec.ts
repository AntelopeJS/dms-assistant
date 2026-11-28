import { z } from "zod";
import {
  ARTIFACT_ALIGNMENTS,
  ARTIFACT_CHART_KINDS,
  ARTIFACT_LIMITS,
  ARTIFACT_TONES,
  type ArtifactKind,
} from "../constants/artifacts.js";

/**
 * What the assistant hands `create_artifact`: data only. Every object is
 * strict, so a key the schema does not name (an `html` field, say) refuses the
 * whole artifact instead of travelling to the dashboard, and every text and
 * list is bounded. The dashboard keeps a mirror of this schema
 * (`frontend-vue/app/views/artifacts/spec.ts`) and refuses to draw a stored
 * artifact that no longer passes it.
 */
function text(maxChars: number) {
  return z.string().trim().min(1).max(maxChars);
}

const Limits = ARTIFACT_LIMITS;

const CellSchema = z.union([
  z.string().max(Limits.CELL_CHARS),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const HeadingBlockSchema = z.strictObject({
  type: z.literal("heading"),
  text: text(Limits.TEXT_CHARS),
});

export const ParagraphBlockSchema = z.strictObject({
  type: z.literal("paragraph"),
  text: text(Limits.PARAGRAPH_CHARS),
});

export const ListBlockSchema = z.strictObject({
  type: z.literal("list"),
  ordered: z.boolean().optional(),
  items: z.array(text(Limits.CELL_CHARS)).min(1).max(Limits.LIST_ITEMS),
});

export const KpiSchema = z.strictObject({
  label: text(Limits.TEXT_CHARS),
  value: z.union([text(Limits.LABEL_CHARS), z.number().finite()]),
  detail: text(Limits.TEXT_CHARS).optional(),
  tone: z.enum(ARTIFACT_TONES).optional(),
});

export const KpisBlockSchema = z.strictObject({
  type: z.literal("kpis"),
  items: z.array(KpiSchema).min(1).max(Limits.KPIS),
});

export const TableColumnSchema = z.strictObject({
  label: text(Limits.LABEL_CHARS),
  align: z.enum(ARTIFACT_ALIGNMENTS).optional(),
});

export const TableBlockSchema = z.strictObject({
  type: z.literal("table"),
  caption: text(Limits.TEXT_CHARS).optional(),
  columns: z.array(TableColumnSchema).min(1).max(Limits.COLUMNS),
  /** One cell per column, in the columns' order; a short row reads as empty cells. */
  rows: z.array(z.array(CellSchema).max(Limits.COLUMNS)).max(Limits.ROWS),
});

export const ChartSeriesSchema = z.strictObject({
  name: text(Limits.LABEL_CHARS),
  data: z.array(z.number().finite()).min(1).max(Limits.POINTS),
});

export const ChartBlockSchema = z
  .strictObject({
    type: z.literal("chart"),
    kind: z.enum(ARTIFACT_CHART_KINDS),
    title: text(Limits.TEXT_CHARS).optional(),
    categories: z
      .array(z.string().max(Limits.LABEL_CHARS))
      .min(1)
      .max(Limits.POINTS),
    series: z.array(ChartSeriesSchema).min(1).max(Limits.SERIES),
  })
  .refine(
    (chart) =>
      chart.series.every(
        (series) => series.data.length === chart.categories.length,
      ),
    { message: "each series needs one value per category" },
  );

export const ArtifactBlockSchema = z.discriminatedUnion("type", [
  HeadingBlockSchema,
  ParagraphBlockSchema,
  ListBlockSchema,
  KpisBlockSchema,
  TableBlockSchema,
  ChartBlockSchema,
]);

export const ArtifactBlocksSchema = z
  .array(ArtifactBlockSchema)
  .min(1)
  .max(Limits.BLOCKS);

export const ArtifactSpecSchema = z.strictObject({
  title: text(Limits.TITLE_CHARS),
  summary: text(Limits.SUMMARY_CHARS).optional(),
  blocks: ArtifactBlocksSchema,
});

export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;
export type ArtifactBlock = z.infer<typeof ArtifactBlockSchema>;

const DATA_BLOCK_TYPES: ReadonlySet<ArtifactBlock["type"]> = new Set([
  "table",
  "chart",
  "kpis",
]);

/**
 * How the artifact is listed: a table or a chart when that is its only data
 * block, a report otherwise (several data blocks, or text alone).
 */
export function artifactKindOf(spec: ArtifactSpec): ArtifactKind {
  const data = spec.blocks.filter((block) => DATA_BLOCK_TYPES.has(block.type));
  const [only] = data;
  if (data.length !== 1 || only === undefined) return "report";
  if (only.type === "table") return "table";
  if (only.type === "chart") return "chart";
  return "report";
}
