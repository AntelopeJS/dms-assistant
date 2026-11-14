import { pageHas, pick, same, text } from "../../ai.mjs";
import { MS_MINUTE, conversation, permission, seedStore, toolResult, toolUse, userMessage } from "../../seed.mjs";
import { log } from "./helpers.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const DELETE = "builder_delete_page";
const ARGS = { pageRef: "/orders" };

/**
 * Seeds one conversation: a page deletion the owner approved and the DMS then held, its repeat that ran, and a read.
 *
 * @param {Ctx} ctx The journey
 */
async function seedHeld(ctx) {
  const at = Date.now() - 30 * MS_MINUTE;
  const asked = { allowedBy: "approved", kind: "destructive", summary: `${DELETE} /orders`, decidedBy: "Verify Admin" };
  const messages = [
    userMessage("Remove the orders page", at - MS_MINUTE),
    toolUse("held", DELETE, ARGS, at, { allowedBy: "approved" }),
    permission("held", DELETE, at, asked),
    toolResult("held", at + 1500, { allowedBy: "approved", status: "error", outcome: "held", content: "The DMS holds this deletion until you confirm it." }),
    toolUse("repeat", DELETE, ARGS, at + 2 * MS_MINUTE, { allowedBy: "approved" }),
    permission("repeat", DELETE, at + 2 * MS_MINUTE, asked),
    toolResult("repeat", at + 2 * MS_MINUTE + 1500, { allowedBy: "approved", content: "Deleted /orders" }),
    toolUse("read", "Read", { file_path: "src/a.ts" }, at + 4 * MS_MINUTE, { allowedBy: "read_auto" }),
    toolResult("read", at + 4 * MS_MINUTE + 500, { allowedBy: "read_auto" }),
  ];
  await seedStore(ctx, { conversations: { "conv-held": conversation(messages) } });
}

export const heldJourneys = [
  {
    id: "an-approved-call-the-dms-held-shows-as-held-under-its-own-tab",
    title: "a deletion the owner approved and the DMS then held reads Held by the DMS, sits under the Held by the DMS tab and not under Denied or blocked",
    entryPoint: "GET /ai/activity, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await seedHeld(ctx);
      const all = await log(ctx, "");
      const held = await log(ctx, "?filter_category=is:held");
      const denied = await log(ctx, "?filter_category=is:denied");
      const row = all.rows.find((r) => text(r, "id") === "conv-held:held");
      await ctx.verify("the log", [
        same("the held call is listed as held, asked", [pick(row, "result"), pick(row, "category")], ["held", ["asked", "held"]]),
        same("the Held tab holds it alone", held.rows.map((r) => text(r, "id")), ["conv-held:held"]),
        same("Denied or blocked does not", denied.total, 0),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await ctx.verify("the page", [
        pageHas(tab, "the tabs", /Failed\s*0\s*Held by the DMS\s*1/),
        pageHas(tab, "the pill", /Held by the DMS/),
        pageHas(tab, "no Not run pill", /Not run/, false),
      ]);
    },
  },
];
