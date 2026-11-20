import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { startDmsMcp } from "../dms-mcp.mjs";
import { guarded } from "../guard.mjs";
import { byRunner } from "../../runner.mjs";
import { check, list, pick, projectPath, text } from "../builder.mjs";

/** @typedef {import("../builder.mjs").Ctx} Ctx */

const PAGE = "/fleet/fleet-overview";
const RENTED_SHARE = 25;

/**
 * @param {string} dir A folder
 * @returns {string[]} The files under it, recursively
 */
function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/**
 * Compiles the project's sources and restarts the backend on them: the playground runs its compiled `dist`.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ status: number | null, output: string }>} How the compile ended
 */
async function compileAndRestart(ctx) {
  const root = projectPath(ctx);
  const compiled = spawnSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json"], { cwd: root, encoding: "utf8" });
  await ctx.restartBackend();
  return { status: compiled.status, output: `${compiled.stdout}${compiled.stderr}` };
}

/**
 * Keeps the project's sources as they are now, and gives back what puts them back: the builder writes into the run's
 * copy of the playground, which the later journeys of the run share.
 *
 * @param {Ctx} ctx The journey
 * @returns {() => void} Restores every file and removes every file added since
 */
function keepSources(ctx) {
  const src = projectPath(ctx, "src");
  const kept = new Map(filesUnder(src).map((file) => [file, readFileSync(file)]));
  return () => {
    for (const file of filesUnder(src)) if (!kept.has(file)) rmSync(file);
    for (const [file, content] of kept) writeFileSync(file, content);
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const dir = join(src, entry.name);
      if (entry.isDirectory() && filesUnder(dir).length === 0) rmSync(dir, { recursive: true });
    }
  };
}

export const { journeys, integrationJourneys } = byRunner(
  guarded([
  {
    id: "a-safe-mode-build-makes-a-percentage-kpi",
    integration: true,
    title: "through the DMS MCP started with Safe mode's access, a build creates a table with its rows, a page, a ratio query and a KpiCard in percent, and the card's route answers the share of rented bikes, not a count",
    entryPoint: "the dms MCP server as a Safe mode chat starts it: builder_create_resource, builder_add_query (template ratio), builder_add_block (KpiCard)",
    backend: "dev",
    last: true,
    async run(/** @type {Ctx} */ ctx) {
      const restore = keepSources(ctx);
      const mcp = await startDmsMcp(projectPath(ctx), "safe");
      try {
        const templates = await mcp.call("builder_query_templates", {});
        const ratio = list(templates.body).find((template) => template.id === "ratio");
        await ctx.verify("Safe mode offers a ratio query", [check("builder_query_templates lists ratio", ratio !== undefined, templates.body)], { critical: true });

        const resource = await mcp.call("builder_create_resource", {
          name: "bikes",
          displayName: "Bikes",
          fields: [
            { name: "label", dataType: { $dataType: "string" } },
            { name: "rented", dataType: { $dataType: "boolean" } },
          ],
          seeds: [
            { label: "B1", rented: true },
            { label: "B2", rented: false },
            { label: "B3", rented: false },
            { label: "B4", rented: false },
          ],
        });
        const category = await mcp.call("builder_create_category", { name: "fleet", displayName: "Fleet", section: true });
        const page = await mcp.call("builder_create_page", { name: "fleet-overview", displayName: "Fleet overview", category: "fleet" });
        const query = await mcp.call("builder_add_query", {
          page: PAGE,
          name: "utilisationRate",
          resource: "bikes",
          template: "ratio",
          params: { numerator: { where: [{ field: "rented", op: "eq", value: true }] }, denominator: {} },
        });
        const route = text(query.body, "data", "route");
        const card = await mcp.call("builder_add_block", {
          page: PAGE,
          name: "utilisationRate",
          type: "KpiCard",
          config: { title: "Utilisation rate", fetchUrl: route, valueFormat: "percent" },
        });
        await ctx.verify("the builder writes the page in Safe mode", [
          check("the table and its rows", pick(resource.body, "ok") === true, resource.body),
          check("the category", pick(category.body, "ok") === true, category.body),
          check("the page", pick(page.body, "ok") === true, page.body),
          check("the ratio query, with its route", pick(query.body, "ok") === true && route !== "", query.body),
          check("the KpiCard", pick(card.body, "ok") === true, card.body),
        ], { critical: true });

        const structure = await mcp.call("builder_page_structure", { pageRef: PAGE });
        const kpi = list(structure.body, "data", "blocks").find((block) => block.name === "utilisationRate");
        const served = list(structure.body, "data", "queries").find((entry) => entry.name === "utilisationRate");
        await ctx.verify("the page holds the percentage KPI the mockup asked for", [
          check("a KpiCard titled Utilisation rate", pick(kpi, "type") === "KpiCard" && pick(kpi, "config", "title") === "Utilisation rate", kpi),
          check("it shows its value in percent", pick(kpi, "config", "valueFormat") === "percent", kpi),
          check("it reads the ratio query's route", pick(kpi, "config", "fetchUrl") === route && pick(served, "template") === "ratio", { kpi, served }),
        ]);

        const compiled = await compileAndRestart(ctx);
        const answer = await ctx.api("read the KPI's route", { method: "GET", path: route });
        await ctx.verify("the KPI answers the share of rented bikes", [
          check("the project compiles", compiled.status === 0, compiled.output),
          check("one bike rented out of four reads 25, which the card shows as 25 %", answer.status === 200 && pick(answer.body, "value") === RENTED_SHARE, answer),
        ]);
      } finally {
        mcp.close();
        restore();
        await compileAndRestart(ctx);
      }
      await ctx.verify("the project is as it was", [check("no bikes source is left", filesUnder(projectPath(ctx, "src")).every((file) => !relative(projectPath(ctx, "src"), file).startsWith("bikes")), "src")]);
    },
  },
  ]),
);

/** The user-facing files these journeys cover, as globs relative to the repository root. */
export const covers = [
  "sidecar/src/mcp/dms-server.ts",
];
