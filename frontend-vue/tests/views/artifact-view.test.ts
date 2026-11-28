/**
 * ArtifactView draws an artifact from its data alone: every text the model wrote
 * reaches the page as text, never as markup.
 *
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArtifactView from "../../app/views/artifacts/ArtifactView.vue";
import type { ArtifactPayload } from "../../app/views/types";
import type { JsonValue } from "../../builder/app/runtime/types";
import { DmsEmptyState } from "../support/stand-ins/DmsEmptyState";

/** Within the 80 characters a label may hold, so the spec accepts it and the view must show it as text. */
const HOSTILE = "<img src=x onerror=alert(1)><script>alert(2)</script>";

/** Everything the markup could have become, had any text been parsed as HTML. */
const SCRIPT_VECTORS =
	"img, script, iframe, object, embed, [onerror], [onload], [onclick], a[href^='javascript:']";

const STUBS = {
	UIcon: true,
	UButton: true,
	DmsEmptyState,
};

function artifact(spec: JsonValue): ArtifactPayload {
	return {
		id: "a-1",
		conversationId: "c-1",
		agent: "claude",
		createdAtMs: Date.UTC(2026, 10, 27, 9, 30),
		kind: "report",
		createdBy: HOSTILE,
		spec,
	};
}

const HOSTILE_SPEC: JsonValue = {
	title: HOSTILE,
	summary: HOSTILE,
	blocks: [
		{ type: "heading", text: HOSTILE },
		{ type: "paragraph", text: `line one\n${HOSTILE}` },
		{ type: "list", items: [HOSTILE] },
		{
			type: "kpis",
			items: [
				{ label: HOSTILE, value: HOSTILE, detail: HOSTILE, tone: "error" },
			],
		},
		{
			type: "table",
			caption: HOSTILE,
			columns: [{ label: HOSTILE }, { label: "n", align: "right" }],
			rows: [
				[HOSTILE, 1234.5],
				["short row"],
				["a", true, "extra cell dropped"],
			],
		},
		{
			type: "chart",
			kind: "bar",
			title: HOSTILE,
			categories: [HOSTILE, "b"],
			series: [{ name: HOSTILE, data: [1, 2] }],
		},
	],
};

function mountArtifact(spec: JsonValue) {
	return mount(ArtifactView, {
		props: { artifact: artifact(spec) },
		global: { stubs: STUBS },
	});
}

beforeEach(() => {
	vi.stubGlobal("useI18n", () => ({
		t: (key: string, params?: Record<string, string | number>) =>
			params ? `${key}:${Object.values(params).join("|")}` : key,
		locale: { value: "en-GB" },
	}));
	vi.stubGlobal("useRegionalFormat", () => ({
		dateTimeFormat: (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }),
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ArtifactView", () => {
	it("shows hostile text in every block as the text it is, and runs nothing (fails a view that parses a field as HTML)", () => {
		const wrapper = mountArtifact(HOSTILE_SPEC);
		expect(wrapper.element.querySelector(SCRIPT_VECTORS)).toBeNull();
		expect(wrapper.element.outerHTML).not.toMatch(
			/<(img|script|iframe|svg onload)\b/i,
		);
		expect(wrapper.get("[data-artifact-title]").text()).toBe(HOSTILE);
		const texts = wrapper
			.findAll(
				"h3, p, li, th, td, caption, figcaption, [data-artifact-kpi] span",
			)
			.map((node) => node.text());
		expect(
			texts.filter((text) => text.includes(HOSTILE)).length,
		).toBeGreaterThanOrEqual(9);
		expect(wrapper.get("svg title").text()).toContain(HOSTILE);
	});

	it("refuses to draw an artifact whose data fails the spec, saying so", () => {
		const wrapper = mountArtifact({
			title: "t",
			blocks: [{ type: "html", html: "<script>alert(1)</script>" }],
		});
		expect(wrapper.element.querySelector(SCRIPT_VECTORS)).toBeNull();
		expect(wrapper.find("[data-artifact-blocks]").exists()).toBe(false);
		expect(wrapper.text()).toContain(
			"dms_assistant.views.artifacts.unreadable_title",
		);
	});

	it("draws one cell per column: a short row ends empty, an extra cell is dropped, figures and booleans read as text", () => {
		const wrapper = mountArtifact(HOSTILE_SPEC);
		const rows = wrapper.findAll("[data-artifact-table] tbody tr");
		expect(rows).toHaveLength(3);
		for (const row of rows) expect(row.findAll("td")).toHaveLength(2);
		expect(rows[0]?.findAll("td")[1]?.text()).toBe("1,234.5");
		expect(rows[1]?.findAll("td")[1]?.text()).toBe("");
		expect(rows[2]?.findAll("td")[1]?.text()).toBe(
			"dms_assistant.views.artifacts.yes",
		);
	});

	it("draws a bar chart as one rect per figure and a line chart as one polyline per series, from the theme's colours", () => {
		const bars = mountArtifact(HOSTILE_SPEC);
		expect(bars.findAll("svg rect")).toHaveLength(2);
		expect(bars.get("svg g[fill]").attributes("fill")).toBe(
			"var(--dms-chart-1)",
		);
		const lines = mountArtifact({
			title: "t",
			blocks: [
				{
					type: "chart",
					kind: "line",
					categories: ["a", "b", "c"],
					series: [
						{ name: "one", data: [1, 2, 3] },
						{ name: "two", data: [-1, 0, 1] },
					],
				},
			],
		});
		expect(lines.findAll("svg polyline")).toHaveLength(2);
		expect(lines.findAll("svg circle")).toHaveLength(6);
		expect(lines.findAll("svg rect")).toHaveLength(0);
	});

	it("names the artifact's kind, time, agent and author in its eyebrow", () => {
		const wrapper = mountArtifact(HOSTILE_SPEC);
		const eyebrow = wrapper.get("header p").text();
		expect(eyebrow).toContain("dms_assistant.views.artifacts.kind.report");
		expect(eyebrow).toContain("dms_assistant.views.agent.claude");
		expect(eyebrow).toContain(
			`dms_assistant.views.artifacts.created_by:${HOSTILE}`,
		);
	});
});
