import { guarded } from "../guard.mjs";
import { ai, check, choose, same, selected, text, until } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** The introduction's first look: the owner reads the status, opens the Settings landing page and changes a default. */
export const journeys = guarded([
  {
    id: "smoke",
    tag: "@smoke",
    title: "an owner reads Ready and Claude Code from the status, opens the Settings landing page, changes Thinking to High and sees it kept after a reload",
    entryPoint: "/modules/ai/settings, GET /ai/status, PUT /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      const status = await ai(ctx, "read the status", "GET", "/status");
      await ctx.verify("the sidecar is ready", [
        same("the status", text(status.body, "status"), "ready"),
        same("the agent", text(status.body, "provider"), "claude"),
      ], { critical: true });
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("the Settings page shows the agent", [
        tab.shows(/Coding agent/, { timeoutMs: 30_000 }),
        selected(tab, { role: "radio", name: "Claude Code" }, true),
      ]);
      await choose(tab, { role: "radio", name: "High" });
      const saved = await until(async () => text((await ai(ctx, "read the settings", "GET", "/settings")).body, "thinking") === "high", { timeoutMs: 45_000, everyMs: 1500 });
      await ctx.verify("the choice is saved as you make it", [check("thinking is high through the API", saved, saved)], { critical: true });
      await tab.reload();
      await ctx.verify("a reload keeps it", [selected(tab, { role: "radio", name: "High" }, true), selected(tab, { role: "radio", name: "Medium" }, false)]);
    },
  },
]);

/** The user-facing files these journeys cover, as globs relative to the repository root. */
export const covers = [
  "src/index.ts",
  "src/config.ts",
  "src/frontend-module.ts",
  "src/constants/**",
  "src/types/**",
  "src/vocabulary/**",
  "src/pages/all.ts",
  "src/pages/index.ts",
  "src/pages/meta.ts",
  "src/pages/module.ts",
];
