/**
 * The dashboard's mirror of the artifact spec: what it draws, and what it refuses.
 * @packageDocumentation
 */
import { describe, expect, it } from "vitest";
import { parseArtifactSpec } from "../../app/views/artifacts/spec";

const HOSTILE = "<img src=x onerror=alert(1)><script>alert(2)</script>";

describe("parseArtifactSpec", () => {
	it("accepts every block type with its data, hostile text kept as text", () => {
		const spec = parseArtifactSpec({
			title: HOSTILE,
			summary: "s",
			blocks: [
				{ type: "heading", text: "h" },
				{ type: "paragraph", text: HOSTILE },
				{ type: "list", ordered: true, items: ["a", HOSTILE] },
				{ type: "kpis", items: [{ label: "l", value: 1, tone: "success" }] },
				{
					type: "table",
					columns: [{ label: "c" }],
					rows: [[HOSTILE, 2, true, null]],
				},
				{
					type: "chart",
					kind: "bar",
					categories: [HOSTILE],
					series: [{ name: HOSTILE, data: [3] }],
				},
			],
		});
		expect(spec?.title).toBe(HOSTILE);
		expect(spec?.blocks).toHaveLength(6);
	});

	it("refuses a key it does not name, a block it does not draw and a ragged chart (fails a mirror looser than the sidecar's)", () => {
		expect(
			parseArtifactSpec({
				title: "t",
				blocks: [{ type: "paragraph", text: "p", html: "<b>x</b>" }],
			}),
		).toBeNull();
		expect(
			parseArtifactSpec({ title: "t", blocks: [{ type: "iframe", src: "x" }] }),
		).toBeNull();
		expect(
			parseArtifactSpec({
				title: "t",
				blocks: [
					{
						type: "chart",
						kind: "line",
						categories: ["a", "b"],
						series: [{ name: "s", data: [1] }],
					},
				],
			}),
		).toBeNull();
		expect(parseArtifactSpec("<p>not an object</p>")).toBeNull();
	});

	it("bounds a table at 500 rows and a cell at 400 characters", () => {
		const table = (rows: unknown[][]) => ({
			title: "t",
			blocks: [{ type: "table", columns: [{ label: "c" }], rows }],
		});
		expect(
			parseArtifactSpec(table(Array.from({ length: 500 }, () => ["x"]))),
		).not.toBeNull();
		expect(
			parseArtifactSpec(table(Array.from({ length: 501 }, () => ["x"]))),
		).toBeNull();
		expect(parseArtifactSpec(table([["x".repeat(401)]]))).toBeNull();
	});
});
