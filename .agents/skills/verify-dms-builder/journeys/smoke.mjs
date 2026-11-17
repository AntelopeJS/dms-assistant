import { guarded } from "../guard.mjs";
import { builder, check, pick, text } from "../builder.mjs";

/** @typedef {import("../builder.mjs").Ctx} Ctx */

/** The first call of the onboarding's "Start from an existing database" path: what the project has, and who may ask. */
export const journeys = guarded([
  {
    id: "smoke",
    title: "an owner lists the catalog connections and reads the project's modules through /api/builder/database, and an anonymous request is refused",
    entryPoint: "GET /api/builder/database/connections, GET /api/builder/database/project",
    async run(/** @type {Ctx} */ ctx) {
      const connections = await builder(ctx, "list the connections", "GET", "/database/connections");
      const project = await builder(ctx, "read the project's modules", "GET", "/database/project");
      const modules = pick(project.body, "modules");
      await ctx.verify("the owner reads the project", [
        check("connections answers an empty list", connections.status === 200 && Array.isArray(connections.body) && connections.body.length === 0, connections),
        check("project answers the configured modules and this module's id", project.status === 200 && Array.isArray(modules) && modules.includes("playground") && text(project.body, "self") === "dms", project.body),
      ], { critical: true });
      const anon = await builder(ctx, "list the connections without signing in", "GET", "/database/connections", { as: "anon" });
      await ctx.verify("an anonymous request is refused", [check("401 for nobody", anon.status === 401, anon.status)]);
    },
  },
]);
