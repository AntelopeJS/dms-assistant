import { sketchRefusals } from "@antelopejs/dms/sketch";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PREVIEW_ERROR_CODES,
  PREVIEW_MAX_JSON_BYTES,
  PREVIEW_SKETCH_MAX_HEIGHT_PX,
} from "../../src/constants/preview.js";
import {
  buildHarness,
  KPI_NODE,
  parse,
  SKETCH,
} from "../helpers/preview-harness.js";

describe("preview_blocks sketches", () => {
  it("shows a sketch beside the DMS tree, with a main tab label", async () => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler({
      title: "Revenue card",
      label: "DMS KpiCard",
      tree: KPI_NODE,
      variants: [{ label: "Custom sketch", sketch: SKETCH }],
    });
    expect(parse(result).ok).toBe(true);
    expect(shown[0]).toMatchObject({
      label: "DMS KpiCard",
      tree: KPI_NODE,
      variants: [{ label: "Custom sketch", sketch: SKETCH }],
    });
  });

  it("accepts a sketch as the only view", async () => {
    const { shown, tool } = buildHarness();
    await tool.handler({ title: "Custom", sketch: { html: "<p>Hi</p>" } });
    expect(shown[0]?.tree).toBeUndefined();
    expect(shown[0]?.sketch).toEqual({ html: "<p>Hi</p>" });
  });

  it("refuses a view with neither tree nor sketch", async () => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler({
      title: "Empty",
      tree: KPI_NODE,
      variants: [{ label: "Nothing" }],
    });
    expect(parse(result).error?.code).toBe(PREVIEW_ERROR_CODES.INVALID_TREE);
    expect(shown).toHaveLength(0);
  });

  it("keeps words that only look like handlers outside a tag", async () => {
    const { shown, tool } = buildHarness();
    await tool.handler({
      title: "Text",
      sketch: { html: "<p>Status: on hold = 3 orders</p>" },
    });
    expect(shown).toHaveLength(1);
  });

  it("counts sketches against the size cap", async () => {
    const { tool } = buildHarness();
    const half = "x".repeat(PREVIEW_MAX_JSON_BYTES / 2);
    const result = await tool.handler({
      title: "Huge",
      sketch: { html: `<p>${half}</p>` },
      variants: [{ label: "B", sketch: { html: `<p>${half}</p>` } }],
    });
    expect(parse(result).error?.code).toBe(PREVIEW_ERROR_CODES.TOO_LARGE);
  });

  it("counts the written-back sketch against the size cap", async () => {
    const { shown, tool } = buildHarness();
    const unquoted = "<b class=a>x</b>".repeat(2_000);
    const fill = "y".repeat(PREVIEW_MAX_JSON_BYTES - unquoted.length - 1_000);
    const html = `${unquoted}${fill}`;
    expect(html.length).toBeLessThan(PREVIEW_MAX_JSON_BYTES);
    const result = await tool.handler({ title: "Quoted", sketch: { html } });
    expect(parse(result).error?.code).toBe(PREVIEW_ERROR_CODES.TOO_LARGE);
    expect(shown).toHaveLength(0);
  });

  it("bounds the sketch height in the schema", () => {
    const schema = z.object(buildHarness().tool.schema);
    const tall = { html: "<p>x</p>", height: PREVIEW_SKETCH_MAX_HEIGHT_PX + 1 };
    expect(schema.safeParse({ title: "T", sketch: tall }).success).toBe(false);
  });
});

describe("preview_blocks sketch check", () => {
  it.each([
    ["a script", { html: "<p>x</p><script>alert(1)</script>" }],
    ["an event handler", { html: '<img src="data:," onerror="alert(1)">' }],
    ["a slash-led handler", { html: "<svg/onload=alert(1)>" }],
    ["a javascript: link", { html: '<a href="javascript:alert(1)">x</a>' }],
    ["an iframe", { html: '<iframe src="data:text/html,x"></iframe>' }],
    ["an object", { html: '<object data="data:,x"></object>' }],
    ["an embed", { html: "<embed>" }],
    ["a stylesheet link", { html: '<link rel="stylesheet">' }],
    ["a base", { html: "<base>" }],
    ["a meta refresh", { html: '<meta http-equiv="refresh" content="0">' }],
    ["a remote image", { html: '<img src="https://x.example/a.png">' }],
    ["a relative image", { html: "<img src=/media/a.png>" }],
    ["a remote link", { html: '<a href="https://x.example">x</a>' }],
    ["a remote srcset", { html: '<img srcset="https://x.example/a.png 2x">' }],
    [
      "a remote CSS url",
      {
        html: "<p>x</p>",
        css: "p { background: url(https://x.example/a.png) }",
      },
    ],
    [
      "a quoted remote CSS url",
      { html: "<p>x</p>", css: "p { background: url( 'https://x' ) }" },
    ],
    [
      "an inline style url",
      { html: '<p style="background:url(//x.example/a)">x</p>' },
    ],
    ["a CSS import", { html: "<p>x</p>", css: "@import 'data:text/css,p{}';" }],
  ])("refuses a sketch with %s", async (_label, sketch) => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler({
      title: "Sketch",
      tree: KPI_NODE,
      variants: [{ label: "S", sketch }],
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error?.code).toBe(PREVIEW_ERROR_CODES.INVALID_SKETCH);
    expect(shown).toHaveLength(0);
  });

  it.each([
    ["a slash-led remote href", { html: "<a/href=https://x>x</a>" }],
    [
      "an escaped CSS url",
      { html: "<p>x</p>", css: "p { background: u\\72l(https://x) }" },
    ],
    [
      "a remote link and a remote image",
      { html: '<a href="https://x">x</a><img src="https://y">' },
    ],
  ])(
    "refuses %s with the DMS sketch check's reasons",
    async (_label, sketch) => {
      const { shown, tool } = buildHarness();
      const result = await tool.handler({ title: "Sketch", sketch });
      const refusals = sketchRefusals(sketch);
      expect(refusals).not.toHaveLength(0);
      expect(parse(result).error?.code).toBe(
        PREVIEW_ERROR_CODES.INVALID_SKETCH,
      );
      for (const refusal of refusals)
        expect(parse(result).message).toContain(refusal);
      expect(shown).toHaveLength(0);
    },
  );

  it("shows the sketch as the DMS sketch check wrote it back", async () => {
    const { shown, tool } = buildHarness();
    await tool.handler({
      title: "Text",
      sketch: { html: "< SCRIPT src=x></script>", height: 200 },
      variants: [{ label: "B", sketch: { html: "<p title='x'>Hi" } }],
    });
    expect(shown[0]?.sketch).toEqual({
      html: "&lt; SCRIPT src=x&gt;",
      height: 200,
    });
    expect(shown[0]?.variants?.[0]?.sketch).toEqual({
      html: '<p title="x">Hi</p>',
    });
  });

  it.each([
    ["only a comment", "<!-- nothing -->"],
    ["a comment and a newline", "\n<!-- todo: card -->\n"],
  ])("refuses a sketch that holds %s", async (_label, html) => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler({ title: "Empty", sketch: { html } });
    expect(parse(result).error?.code).toBe(PREVIEW_ERROR_CODES.INVALID_SKETCH);
    expect(shown).toHaveLength(0);
  });
});
