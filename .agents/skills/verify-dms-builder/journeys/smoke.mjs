import { guarded } from "../guard.mjs";
import { BOARD, blockDraft, builder, check, isRow, list, pick, rebuild, readProject, text } from "../builder.mjs";

/** @typedef {import("../builder.mjs").Ctx} Ctx */

const PAGE_FILE = "src/board/page.ts";

/** The introduction's "What one change looks like": retitle a card through the HTTP API, and read the change in the source. */
export const journeys = guarded([
  {
    id: "smoke",
    title: "an owner retitles the Board page's Revenue card through POST /page/blocks, and the new title is in the page source, in the structure API and on the reloaded page",
    entryPoint: "GET /api/builder/status, GET /api/builder/page, POST /api/builder/page/blocks",
    async run(/** @type {Ctx} */ ctx) {
      const status = await builder(ctx, "read the status", "GET", "/status");
      await ctx.verify("the builder is on and edits the run's playground", [
        check("GET /status answers ok", status.status === 200 && pick(status.body, "ok") === true, status.body),
        check("the project root is the run's copy of the playground", text(status.body, "projectRoot").endsWith("/playground"), text(status.body, "projectRoot")),
      ]);
      const read = await builder(ctx, "read the Board page", "GET", `/page?ref=${encodeURIComponent(BOARD)}`);
      const version = text(read.body, "data", "version");
      const blocks = list(read.body, "data", "blocks").map((node) => blockDraft(node));
      const revenue = blocks.find((block) => pick(block, "config", "title") === "Revenue");
      await ctx.verify("the Board page has a version and a Revenue card", [check("a version and a Revenue card", version !== "" && revenue !== undefined, read.body)], { critical: true });
      if (revenue && isRow(revenue.config)) revenue.config.title = "Revenue invoiced";
      const saved = await builder(ctx, "write the retitled card", "POST", "/page/blocks", { body: { page: BOARD, draft: { blocks }, expectedVersion: version } });
      await ctx.verify("the write is accepted", [check("the answer is ok with a new version", pick(saved.body, "ok") === true && text(saved.body, "data", "version") !== version, saved.body)], { critical: true });
      const after = readProject(ctx, "the Board page after", PAGE_FILE);
      await ctx.verify("the source holds the new title", [
        check("the card's title is the new one", after.text.includes('title: "Revenue invoiced"'), "page.ts"),
        check("the old title is gone from the card", !after.text.includes('title: "Revenue",'), "page.ts"),
        check("the other blocks are still in the file", ["Orders by status", "Chart card 3", "New order", "Form 2"].every((title) => after.text.includes(title)), "page.ts"),
      ]);
      const structure = await builder(ctx, "read the page structure", "GET", `/page?ref=${encodeURIComponent(BOARD)}`);
      const card = list(structure.body, "data", "blocks").find((block) => text(block, "name") === "revenueChart");
      await ctx.verify("the structure API reads the new title back", [check("revenueChart's config title", text(card, "config", "title") === "Revenue invoiced", card)]);
      await ctx.verify("the project compiles and serves the page", [await rebuild(ctx)], { critical: true });
      const reload = await ctx.tab();
      await reload.signIn("admin");
      await reload.goto(BOARD);
      await ctx.verify("the reloaded page shows the new title", [reload.shows(/Revenue invoiced/i, { timeoutMs: 30_000 })]);
    },
  },
]);
