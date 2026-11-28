import { describe, expect, it } from "vitest";
import {
  type ArtifactSpec,
  ArtifactSpecSchema,
  artifactKindOf,
} from "../../src/artifacts/spec.js";
import { ARTIFACT_LIMITS } from "../../src/constants/artifacts.js";

const HOSTILE = "<img src=x onerror=alert(1)><script>alert(2)</script>";

const HEADING: ArtifactSpec["blocks"][number] = {
  type: "heading",
  text: "By month",
};

const CHART: ArtifactSpec["blocks"][number] = {
  type: "chart",
  kind: "bar",
  categories: ["Jul", "Aug", "Sep"],
  series: [{ name: "Refunds", data: [12, 9, 15] }],
};

const TABLE: ArtifactSpec["blocks"][number] = {
  type: "table",
  columns: [{ label: "Order" }, { label: "Amount", align: "right" }],
  rows: [
    ["#1042", 120.5],
    ["#1077", 99],
    ["#1090", null],
  ],
};

const REPORT: ArtifactSpec = {
  title: "Refunds · Q3",
  summary: "Refunds by month and the three largest.",
  blocks: [HEADING, CHART, TABLE],
};

describe("the artifact spec", () => {
  it("accepts a report with a chart and a table, and names its kind", () => {
    const parsed = ArtifactSpecSchema.safeParse(REPORT);
    expect(parsed.success).toBe(true);
    expect(artifactKindOf(REPORT)).toBe("report");
    expect(artifactKindOf({ ...REPORT, blocks: [TABLE] })).toBe("table");
    expect(artifactKindOf({ ...REPORT, blocks: [CHART] })).toBe("chart");
    expect(artifactKindOf({ ...REPORT, blocks: [HEADING] })).toBe("report");
  });

  it("keeps hostile markup as the text it is, nowhere interpreted (fails a schema that strips or rewrites it)", () => {
    const spec: ArtifactSpec = {
      title: HOSTILE,
      blocks: [
        { type: "paragraph", text: HOSTILE },
        {
          type: "table",
          columns: [{ label: HOSTILE }],
          rows: [[HOSTILE]],
        },
      ],
    };
    const parsed = ArtifactSpecSchema.parse(spec);
    expect(parsed.title).toBe(HOSTILE);
    expect(parsed.blocks[1]).toEqual(spec.blocks[1]);
  });

  it("refuses a key the schema does not name, so an html field never reaches the dashboard", () => {
    const withHtml = {
      ...REPORT,
      blocks: [{ type: "paragraph", text: "ok", html: "<b>x</b>" }],
    };
    expect(ArtifactSpecSchema.safeParse(withHtml).success).toBe(false);
    expect(
      ArtifactSpecSchema.safeParse({ ...REPORT, html: "<b>x</b>" }).success,
    ).toBe(false);
  });

  it("refuses a block type it does not draw", () => {
    const unknown = { ...REPORT, blocks: [{ type: "iframe", src: "x" }] };
    expect(ArtifactSpecSchema.safeParse(unknown).success).toBe(false);
  });

  it("bounds what one artifact holds: blocks, rows, cells and titles", () => {
    const tooManyBlocks = {
      ...REPORT,
      blocks: Array.from({ length: ARTIFACT_LIMITS.BLOCKS + 1 }, () => ({
        type: "heading",
        text: "h",
      })),
    };
    const tooManyRows = {
      title: "t",
      blocks: [
        {
          type: "table",
          columns: [{ label: "a" }],
          rows: Array.from({ length: ARTIFACT_LIMITS.ROWS + 1 }, () => ["x"]),
        },
      ],
    };
    const longCell = {
      title: "t",
      blocks: [
        {
          type: "table",
          columns: [{ label: "a" }],
          rows: [["x".repeat(ARTIFACT_LIMITS.CELL_CHARS + 1)]],
        },
      ],
    };
    const longTitle = {
      ...REPORT,
      title: "t".repeat(ARTIFACT_LIMITS.TITLE_CHARS + 1),
    };
    for (const spec of [tooManyBlocks, tooManyRows, longCell, longTitle]) {
      expect(ArtifactSpecSchema.safeParse(spec).success).toBe(false);
    }
    expect(
      ArtifactSpecSchema.safeParse({ title: " ", blocks: [] }).success,
    ).toBe(false);
  });

  it("refuses a chart whose series do not match its categories, and non-finite figures", () => {
    const ragged = {
      title: "t",
      blocks: [
        {
          type: "chart",
          kind: "line",
          categories: ["a", "b"],
          series: [{ name: "s", data: [1] }],
        },
      ],
    };
    const infinite = {
      title: "t",
      blocks: [
        {
          type: "chart",
          kind: "bar",
          categories: ["a"],
          series: [{ name: "s", data: [Number.POSITIVE_INFINITY] }],
        },
      ],
    };
    expect(ArtifactSpecSchema.safeParse(ragged).success).toBe(false);
    expect(ArtifactSpecSchema.safeParse(infinite).success).toBe(false);
  });
});
