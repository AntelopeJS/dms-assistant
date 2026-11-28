import { guarded } from "../guard.mjs";
import { byRunner } from "../runner.mjs";
import { ai, pageHas, pick, same, text, withEnv } from "../ai.mjs";
import { seedStore } from "../seed.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** Markup the model could write into an artifact: the page must show it as text and run none of it. */
const HOSTILE_TITLE = '<img src=x onerror=alert(1)>';

/** An artifact as `artifacts.json` holds it, owned by the admin's user id. */
const ARTIFACT = {
  id: "art-one",
  conversationId: "conv-art",
  agent: "claude",
  createdAtMs: Date.UTC(2026, 10, 27, 9, 30),
  kind: "report",
  createdBy: "Verify Admin",
  spec: {
    title: HOSTILE_TITLE,
    summary: "Refunds by month.",
    blocks: [
      { type: "kpis", items: [{ label: "Refunds", value: 36, tone: "warning" }] },
      {
        type: "table",
        columns: [{ label: "Month" }, { label: "Refunds", align: "right" }],
        rows: [["Jul", 12], ["Aug", 9], ["Sep", 15]],
      },
      { type: "chart", kind: "bar", categories: ["Jul", "Aug", "Sep"], series: [{ name: "Refunds", data: [12, 9, 15] }] },
    ],
  },
};

export const { journeys, integrationJourneys } = byRunner(
  guarded([
  {
    id: "no-artifact-yet-says-so",
    title: "before the assistant saved anything the Artifacts page says No artifact to show, the list answers empty, and an artifact that does not exist answers 404",
    entryPoint: "/modules/ai/artifacts, GET /ai/artifacts, GET /ai/artifacts/:id",
    async run(/** @type {Ctx} */ ctx) {
      await seedStore(ctx, {});
      const listed = await ai(ctx, "list", "GET", "/artifacts");
      const unknown = await ai(ctx, "an unknown artifact", "GET", "/artifacts/nope");
      await ctx.verify("the API", [
        same("an empty list", listed.body, { results: [], total: 0 }),
        same("an unknown artifact is 404", [unknown.status, text(unknown.body, "message")], [404, "Unknown artifact."]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/artifacts");
      await ctx.verify("the page", [
        pageHas(tab, "the empty state", /No artifact to show/),
        pageHas(tab, "what it will hold", /Ask the assistant for a report, a table or a chart of its results\./),
      ]);
      await tab.goto("/modules/ai/artifacts?artifact=nope");
      await ctx.verify("a link to an artifact that does not exist", [pageHas(tab, "says it could not be loaded", /Couldn't load this/), pageHas(tab, "no server error", /Internal Server Error|500/, false)]);
    },
  },
  {
    id: "the-artifacts-say-when-the-assistant-is-down",
    title: "with the sidecar off the Artifacts page says Can't reach the assistant, and the routes answer 503",
    entryPoint: "DMS_ASSISTANT=0, /modules/ai/artifacts?artifact=<id>",
    async run(/** @type {Ctx} */ ctx) {
      await withEnv(ctx, { DMS_ASSISTANT: "0" }, async () => {
        const listed = await ai(ctx, "list", "GET", "/artifacts");
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/ai/artifacts?artifact=art-one");
        await ctx.verify("down", [
          same("the list is 503", listed.status, 503),
          pageHas(tab, "the offline state", /Can't reach the assistant/),
        ]);
      });
    },
  },
  {
    id: "a-saved-artifact-opens-from-its-link-as-text-and-figures",
    title: "a stored artifact of the owner lists with its title and opens from ?artifact=<id> with its kpis, table and chart; its hostile title reads as text and runs nothing; another owner's artifact and the owner-less list stay apart",
    entryPoint: "/modules/ai/artifacts?artifact=<id>, GET /ai/artifacts, GET /ai/artifacts/:id",
    async run(/** @type {Ctx} */ ctx) {
      const admin = ctx.state.accounts?.admin?.userId ?? "";
      await seedStore(ctx, { artifacts: [{ ...ARTIFACT, ownerId: admin }, { ...ARTIFACT, id: "art-foreign", ownerId: "someone-else", spec: { ...ARTIFACT.spec, title: "Foreign" } }] });
      const listed = await ai(ctx, "list", "GET", "/artifacts");
      const own = await ai(ctx, "the owner's artifact", "GET", "/artifacts/art-one");
      const foreign = await ai(ctx, "another owner's artifact", "GET", "/artifacts/art-foreign");
      await ctx.verify("the API", [
        same("the owner's artifact alone, without its blocks", [listed.status, text(listed.body, "results", "0", "title"), text(listed.body, "results", "0", "spec")], [200, HOSTILE_TITLE, ""]),
        same("one artifact listed", pick(listed.body, "total"), 1),
        same("the owner opens theirs, with its data", [own.status, text(own.body, "spec", "title")], [200, HOSTILE_TITLE]),
        same("another owner's artifact reads as unknown", [foreign.status, text(foreign.body, "message")], [404, "Unknown artifact."]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/artifacts?artifact=art-one");
      const injected = await tab.page.locator("img[src='x']").count();
      await ctx.verify("the page", [
        pageHas(tab, "the title, as text", /<img src=x onerror=alert\(1\)>/),
        same("no image the title could inject", injected, 0),
        pageHas(tab, "its eyebrow", /Report · [^\n]*· Claude Code · by Verify Admin/),
        pageHas(tab, "its summary", /Refunds by month\./),
        pageHas(tab, "the kpi", /Refunds\s*36/),
        pageHas(tab, "the table", /Month\s*Refunds\s*Jul\s*12\s*Aug\s*9\s*Sep\s*15/),
        pageHas(tab, "the chart's legend", /Series\s*Refunds|Refunds\s*$/),
      ]);
    },
  },
  ]),
);

/** The user-facing files these journeys cover, as globs relative to the repository root. */
export const covers = [
  "src/routes/artifacts.ts",
  "src/pages/artifacts/**",
  "src/types/artifacts.ts",
  "sidecar/src/artifacts/**",
  "sidecar/src/constants/artifacts.ts",
  "sidecar/src/constants/tool-titles.ts",
  "sidecar/src/state/artifacts.ts",
  "sidecar/src/server/artifact-routes.ts",
  "sidecar/src/mcp/tools/create-artifact.ts",
  "frontend-vue/app/views/artifacts/**",
  "frontend-vue/app/components/ArtifactsView.vue",
];
