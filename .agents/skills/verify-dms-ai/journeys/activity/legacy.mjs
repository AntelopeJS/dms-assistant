import { pageHas, same, text } from "../../ai.mjs";
import { MS_HOUR, MS_MINUTE, conversation, seedStore, toolResult, toolUse, userMessage } from "../../seed.mjs";
import { log } from "./helpers.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const legacyJourneys = [
  {
    id: "a-call-recorded-under-a-legacy-tool-name-reads-under-the-current-one",
    title: "a stored conversation that names Builder tools in the old CamelCase, with and without the mcp__dms-ai__ prefix, shows them in the Activity log under their snake_case names, from the Builder, and allowed automatically",
    entryPoint: "GET /ai/activity, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      const now = Date.now();
      const at = now - MS_HOUR;
      const call = (/** @type {string} */ id, /** @type {string} */ name, /** @type {number} */ when) => [toolUse(id, name, { pageId: "home" }, when), toolResult(id, when + 800)];
      await seedStore(ctx, {
        conversations: {
          "conv-legacy": conversation([userMessage("Add a block", at - MS_MINUTE), ...call("legacy-1", "BuilderAddBlock", at), ...call("legacy-2", "mcp__dms-ai__BuilderAddBlock", at + 2 * MS_MINUTE)]),
        },
      });
      const activity = await log(ctx, "");
      await ctx.verify("the stored legacy names", [
        same("two rows, both under the current name", [activity.total, activity.tools], [2, ["builder_add_block", "builder_add_block"]]),
        same("both allowed as Builder operations, not asked about", activity.rows.map((row) => [text(row, "allowedBy"), text(row, "result")]), [["builder_auto", "done"], ["builder_auto", "done"]]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await ctx.verify("the page", [pageHas(tab, "the rows read Add block, allowed as a Builder operation", /Add block\s*Builder, automatic\s*Done[\s\S]*Add block\s*Builder, automatic\s*Done/)]);
    },
  },
];
