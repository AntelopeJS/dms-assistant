import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { BOARD, builder, check, list, member, projectPath, readProject, text, withConfig } from "../builder.mjs";

/** @typedef {import("../builder.mjs").Ctx} Ctx */

const DENIED = [401, 403];

/** A dry run of one added module: the answer names the file it would write. */
const DRY_RUN = { steps: [{ op: "AddModule", id: "verify-extra", entry: { source: { type: "package", package: "@antelopejs/verify-extra", version: "^1.0.0" } } }], opts: { dryRun: true } };

/**
 * Every route of the Database workspace, with a request that changes nothing for the owner. The connection check
 * answers the owner `403` outside development, so the owner is not asked there (see `connection-check`).
 *
 * @type {{ method: string, path: string, body?: unknown, ownerAnswered: boolean }[]}
 */
const ROUTES = [
  { method: "GET", path: "/database/connections", ownerAnswered: true },
  { method: "GET", path: "/database/project", ownerAnswered: true },
  { method: "GET", path: "/database/analysis?connection=nope", ownerAnswered: true },
  { method: "GET", path: "/database/connection?connection=nope", ownerAnswered: true },
  { method: "GET", path: "/database/mapping?connection=nope&module=nope", ownerAnswered: true },
  { method: "POST", path: "/database/connections/repair", body: { dryRun: true }, ownerAnswered: true },
  { method: "POST", path: "/database/connections/check", body: { engine: "mongodb", url: "mongodb://127.0.0.1:1/x" }, ownerAnswered: false },
  { method: "POST", path: "/database/analyse", body: { connection: "nope" }, ownerAnswered: true },
  { method: "POST", path: "/database/map", body: { connection: "nope", module: "nope" }, ownerAnswered: true },
  { method: "POST", path: "/database/project", body: { steps: [], opts: { dryRun: true } }, ownerAnswered: true },
  { method: "POST", path: "/database/connection/remove", body: { connection: "nope", dryRun: true }, ownerAnswered: true },
  { method: "POST", path: "/database/connection/url", body: { connection: "nope", url: "postgres://u:p@h/db" }, ownerAnswered: true },
  { method: "POST", path: "/database/sample", body: { connection: "nope", relation: "orders", columns: ["id"], limit: 5 }, ownerAnswered: true },
  { method: "GET", path: "/database/run", ownerAnswered: true },
];

export const journeys = guarded([
  {
    id: "every-route-needs-a-tenant-owner",
    title: "Every /api/builder/database route refuses an anonymous request and a member who is not the owner, and the owner reaches it",
    entryPoint: "GET|POST /api/builder/database/*",
    async run(/** @type {Ctx} */ ctx) {
      await member(ctx, "reader", []);
      const configBefore = readProject(ctx, "antelope.config.ts before", "antelope.config.ts").text;
      /** @type {import("../builder.mjs").Check[]} */
      const checks = [];
      for (const { method, path, body, ownerAnswered } of ROUTES) {
        const anon = await builder(ctx, `anonymous ${method} ${path}`, method, path, { as: "anon", body });
        const reader = await builder(ctx, `member ${method} ${path}`, method, path, { as: "reader", body });
        checks.push(
          check(`${method} ${path}: anonymous is refused`, DENIED.includes(anon.status ?? 0), anon.status),
          check(`${method} ${path}: a member without ownership is refused`, DENIED.includes(reader.status ?? 0), reader.status),
        );
        if (!ownerAnswered) continue;
        const owner = await builder(ctx, `owner ${method} ${path}`, method, path, { body });
        checks.push(check(`${method} ${path}: the owner reaches the route`, !DENIED.includes(owner.status ?? 0) && owner.body !== "Not Found", owner));
      }
      await ctx.verify("every route", checks);
      const configAfter = readProject(ctx, "antelope.config.ts after", "antelope.config.ts").text;
      await ctx.verify("the refused requests wrote nothing", [check("antelope.config.ts is unchanged", configAfter === configBefore, configAfter.length)]);
    },
  },
  {
    id: "the-routes-follow-api-enabled-and-the-start-mode",
    title: "Under ajs project start the routes are off unless builder.api.enabled is true: with it forced on they answer, left unset or forced off they answer 404 and the dashboard still serves the page",
    entryPoint: "GET /api/builder/database/connections, GET /api/builder/database/project",
    async run(/** @type {Ctx} */ ctx) {
      const on = await builder(ctx, "connections with api.enabled true", "GET", "/database/connections");
      await ctx.verify("forced on: the routes answer", [check("connections answers 200", on.status === 200, on.status)]);
      for (const mode of ["follow-dev", "off"]) {
        await withConfig(ctx, { VERIFY_BUILDER_API: mode }, async () => {
          await ctx.verify(`${mode}: signed in again`, [check("the admin session survives a restart", (await ctx.api("a session read", { method: "GET", path: "/api/auth/me" })).status !== 0, "me")]);
          const connections = await ctx.api(`${mode}: connections`, { method: "GET", path: "/api/builder/database/connections" });
          const project = await ctx.api(`${mode}: project`, { method: "GET", path: "/api/builder/database/project" });
          const bare = await ctx.tab();
          await bare.signIn("admin");
          await bare.goto(BOARD);
          await ctx.verify(`api.enabled ${mode === "off" ? "false" : "unset"} under ajs project start`, [
            check("/database/connections answers 404", connections.status === 404, connections.status),
            check("/database/project answers 404", project.status === 404, project.status),
            check("the 404 is the router's, not a route's refusal", text(connections.body, "code") === "", connections.body),
            bare.visible({ role: "heading", name: "Board", level: 1 }, { timeoutMs: 30_000 }),
          ]);
        });
      }
      const back = await builder(ctx, "connections after the restarts", "GET", "/database/connections");
      await ctx.verify("the module's configuration is back", [check("connections answers 200 again", back.status === 200, back.status)]);
    },
  },
  {
    id: "project-root-decides-where-the-connect-flow-writes",
    title: "builder.projectRoot names the source root: a dry run of ConfigureProject names the configuration file under it, a relative root resolves against the process working directory, and the default is the playground",
    entryPoint: "POST /api/builder/database/project with builder.projectRoot set",
    async run(/** @type {Ctx} */ ctx) {
      const own = await builder(ctx, "dry run on the default root", "POST", "/database/project", { body: DRY_RUN });
      await ctx.verify("the default root is the playground", [check("the configuration file is the run's copy", text(list(own.body, "changes")[0], "path") === projectPath(ctx, "antelope.config.ts"), own.body)], { critical: true });
      const elsewhere = join(ctx.state.dir, "alternative-root");
      mkdirSync(elsewhere, { recursive: true });
      copyFileSync(projectPath(ctx, "antelope.config.ts"), join(elsewhere, "antelope.config.ts"));
      await withConfig(ctx, { VERIFY_BUILDER_PROJECT_ROOT: elsewhere }, async () => {
        const moved = await ctx.api("dry run on another root", { method: "POST", path: "/api/builder/database/project", body: DRY_RUN });
        await ctx.verify("an absolute projectRoot is where the configuration is read", [check("the change names the file under that root", text(list(moved.body, "changes")[0], "path") === join(elsewhere, "antelope.config.ts"), moved.body)]);
      });
      await withConfig(ctx, { VERIFY_BUILDER_PROJECT_ROOT: "." }, async () => {
        const dot = await ctx.api("dry run on a relative root", { method: "POST", path: "/api/builder/database/project", body: DRY_RUN });
        const path = text(list(dot.body, "changes")[0], "path");
        await ctx.verify("a relative projectRoot resolves against the working directory", [
          check("the file is an absolute path", path.startsWith("/") && path.endsWith("/antelope.config.ts"), dot.body),
          check("it is not the literal dot", !path.startsWith("./") && path.length > "/antelope.config.ts".length, path),
        ]);
      });
    },
  },
]);
