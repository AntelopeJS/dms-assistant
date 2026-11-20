import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { byRunner } from "../../runner.mjs";
import { builder, check, isRow, isText, items, list, pick, projectPath, readProject, text, withConfig } from "../builder.mjs";

/** @typedef {import("../builder.mjs").Ctx} Ctx */

const CONFIG_FILE = "antelope.config.ts";

/** A value no other journey writes, so its presence in `.env` is a change the running project did not load. */
const PROBE = "VERIFY_RELOAD_PROBE=changed";

/** A configuration whose database module is keyed by a computed name, which `@antelopejs/dms` cannot write again. */
const COMPUTED_NAME_CONFIG = `import { defineConfig } from "@antelopejs/interface-core/config";

const DATABASE = "mongodb";

export default defineConfig({
  name: "verify-computed-name",
  modules: { [DATABASE]: { source: { type: "package", package: "@antelopejs/mongodb", version: "~1.8.11" } } },
});
`;

/**
 * Writes the project's `.env`, or removes it when `text` is null.
 *
 * @param {Ctx} ctx The journey
 * @param {string | null} text The file's text
 * @returns {void}
 */
function writeEnv(ctx, text) {
  if (text === null) rmSync(projectPath(ctx, ".env"), { force: true });
  else writeFileSync(projectPath(ctx, ".env"), text);
}

/**
 * The project's `.env`, which holds secrets, so it stays out of the evidence.
 *
 * @param {Ctx} ctx The journey
 * @returns {string | null} Its text, null when the file is missing
 */
function envFile(ctx) {
  try {
    return readFileSync(projectPath(ctx, ".env"), "utf8");
  } catch {
    return null;
  }
}

export const { journeys, integrationJourneys } = byRunner(
  guarded([
  {
    id: "a-project-without-an-external-database-answers-the-documented-empties-and-404s",
    integration: true,
    title: "On a project with no catalog connection the Database routes list no connection and answer 404 or a not_found refusal for an unknown connection, analysis or mapping, and no route samples rows",
    entryPoint: "GET /api/builder/database/*, POST /api/builder/database/sample",
    async run(/** @type {Ctx} */ ctx) {
      const connections = await builder(ctx, "connections", "GET", "/database/connections");
      const analysis = await builder(ctx, "analysis of an unknown connection", "GET", "/database/analysis?connection=nope");
      const analysisById = await builder(ctx, "analysis by an unknown id", "GET", "/database/analysis?id=nope");
      const connection = await builder(ctx, "an unknown connection", "GET", "/database/connection?connection=nope");
      const sample = await builder(ctx, "the removed sample route", "POST", "/database/sample", { body: { connection: "nope", relation: "orders", columns: ["id"], limit: 5 } });
      const mapping = await builder(ctx, "mapping of an unknown connection", "GET", "/database/mapping?connection=nope&module=nope");
      await ctx.verify("the reads", [
        check("connections is an empty list", connections.status === 200 && Array.isArray(connections.body) && connections.body.length === 0, connections),
        check("an unknown analysis connection is 404 with its ref", analysis.status === 404 && text(analysis.body, "code") === "not_found" && text(analysis.body, "ref") === "nope", analysis),
        check("an unknown analysis id answers a not_found OpResult", pick(analysisById.body, "ok") === false && text(analysisById.body, "error", "code") === "not_found", analysisById),
        check("an unknown connection is 404 with its ref", connection.status === 404 && text(connection.body, "code") === "not_found" && text(connection.body, "ref") === "nope", connection),
        check("the owner's sample request is the API server's 404: no route answers rows", sample.status === 404 && sample.body === "Not Found", sample),
        check("an unknown mapping answers a refusal, not a 200 mapping", mapping.status !== 200 || pick(mapping.body, "ok") === false, mapping),
      ]);
    },
  },
  {
    id: "the-project-answer-carries-the-fields-the-connect-form-reads",
    integration: true,
    title: "GET /database/project lists the configured modules and answers this module's id, the project's own database and the pins to it, and leaves dms-database out when the project has none",
    entryPoint: "GET /api/builder/database/project",
    async run(/** @type {Ctx} */ ctx) {
      const project = await builder(ctx, "project", "GET", "/database/project");
      const modules = items(project.body, "modules");
      const pins = list(project.body, "databasePins");
      await ctx.verify("the answer", [
        check("it is a 200", project.status === 200, project.status),
        check("modules holds the playground's modules by id", ["playground", "dms-assistant", "dms", "mongodb"].every((id) => modules.includes(id)), modules),
        check("every module is an id string", modules.every(isText), modules),
        check("self is the id of the module that answers, dms, and one of the modules", text(project.body, "self") === "dms" && modules.includes("dms"), project.body),
        check("ownDatabase is the project's interface-database provider", text(project.body, "ownDatabase") === "mongodb", project.body),
        check("databasePins holds a module and its provider each, a provider that is the own database", pins.length > 0 && pins.every((pin) => isText(pin.module) && modules.includes(pin.module) && pin.provider === "mongodb"), pins),
        check("dmsDatabase is absent, the project has no dms-database", !isRow(project.body) || !("dmsDatabase" in project.body), project.body),
      ]);
    },
  },
  {
    id: "writes-that-are-refused-or-dry-run-leave-the-project-untouched",
    integration: true,
    title: "A refused connection write, a dry run and a repair with nothing to repair answer as documented and leave antelope.config.ts and .env as they were",
    entryPoint: "POST /api/builder/database/connection/remove|connection/url|analyse|map|project|connections/repair",
    async run(/** @type {Ctx} */ ctx) {
      const configBefore = readProject(ctx, "antelope.config.ts before", CONFIG_FILE);
      const envBefore = envFile(ctx);
      await ctx.verify("the project has a configuration to protect", [check("antelope.config.ts is read", configBefore.exists && configBefore.text.includes('"dms-assistant"'), configBefore.text.length)], { critical: true });

      const remove = await builder(ctx, "remove an unknown connection", "POST", "/database/connection/remove", { body: { connection: "nope", dryRun: true } });
      const url = await builder(ctx, "set the url of an unknown connection", "POST", "/database/connection/url", { body: { connection: "nope", url: "postgres://u:p@h/db" } });
      const analyse = await builder(ctx, "analyse an unknown connection", "POST", "/database/analyse", { body: { connection: "nope" } });
      const map = await builder(ctx, "map an unknown connection", "POST", "/database/map", { body: { connection: "nope", module: "nope" } });
      const existing = await builder(ctx, "add a module that exists", "POST", "/database/project", { body: { steps: [{ op: "AddModule", id: "mongodb", entry: {} }] } });
      await ctx.verify("the refusals", [
        check("remove answers ok false with unsupported and names the connection", pick(remove.body, "ok") === false && text(remove.body, "error", "code") === "unsupported" && text(remove.body, "error", "detail").includes('"nope"'), remove),
        check("setting a url on an unknown connection is invalid_config", pick(url.body, "ok") === false && text(url.body, "error", "code") === "invalid_config", url),
        check("analysing an unknown connection is invalid_config", pick(analyse.body, "ok") === false && text(analyse.body, "error", "code") === "invalid_config", analyse),
        check("mapping an unknown connection is invalid_config", pick(map.body, "ok") === false && text(map.body, "error", "code") === "invalid_config", map),
        check("a step on an existing module id is refused with invalid_config", pick(existing.body, "ok") === false && text(existing.body, "error", "code") === "invalid_config", existing),
      ]);

      const dryRun = await builder(ctx, "dry run of an added module", "POST", "/database/project", { body: { steps: [{ op: "AddModule", id: "verify-extra", entry: { source: { type: "package", package: "@antelopejs/verify-extra", version: "^1.0.0" } } }], opts: { dryRun: true } } });
      const diff = text(list(dryRun.body, "changes")[0], "diff");
      const dryRunVariable = await builder(ctx, "dry run of an added module with a variable", "POST", "/database/project", {
        body: {
          steps: [{ op: "AddModule", id: "verify-extra", entry: { source: { type: "package", package: "@antelopejs/verify-extra", version: "^1.0.0" }, env: { url: "VERIFY_EXTRA_URL" } } }],
          opts: { dryRun: true },
          variables: [{ name: "VERIFY_EXTRA_URL", value: "postgres://u:verify-dry-run@h/db" }],
        },
      });
      const repairDry = await builder(ctx, "repair as a dry run", "POST", "/database/connections/repair", { body: { dryRun: true } });
      const repair = await builder(ctx, "repair", "POST", "/database/connections/repair");
      const repairAgain = await builder(ctx, "repair again", "POST", "/database/connections/repair", { body: {} });
      const emptySuccess = (/** @type {import("../builder.mjs").Answer} */ answer) =>
        answer.status === 200 && pick(answer.body, "ok") === true && list(answer.body, "changes").length === 0 && Array.isArray(pick(answer.body, "data", "files")) && items(answer.body, "data", "files").length === 0;
      await ctx.verify("the dry run and the repair", [
        check("the dry run is ok and shows the module it would add", pick(dryRun.body, "ok") === true && diff.includes('"verify-extra"') && diff.includes("@antelopejs/verify-extra"), dryRun.body),
        check("a dry run with a variable is ok and shows the module it would add", pick(dryRunVariable.body, "ok") === true && text(list(dryRunVariable.body, "changes")[0], "diff").includes('"verify-extra"'), dryRunVariable.body),
        check("a repair dry run is an empty success", emptySuccess(repairDry), repairDry),
        check("a repair with nothing missing is an empty success", emptySuccess(repair), repair),
        check("a second repair changes nothing either", emptySuccess(repairAgain), repairAgain),
      ]);

      const configAfter = readProject(ctx, "antelope.config.ts after", CONFIG_FILE);
      const envAfter = envFile(ctx);
      const modules = await builder(ctx, "the modules after", "GET", "/database/project");
      await ctx.verify("nothing was written", [
        check("antelope.config.ts is byte for byte the same", configAfter.text === configBefore.text, configAfter.text.length),
        check(".env is the same, or still absent, and holds no dry-run variable", envAfter === envBefore && !(envAfter ?? "").includes("VERIFY_EXTRA_URL"), envAfter === null ? "absent" : envAfter.length),
        check("the project's module list does not hold the dry-run module", !JSON.stringify(pick(modules.body, "modules")).includes("verify-extra"), modules.body),
      ]);
    },
  },
  {
    id: "the-reload-route-says-when-env-changed-since-the-project-loaded-it",
    title: "GET /database/reload answers due false while .env holds the values the running project loaded, true once a value changes, false again once the value is back, and false after a restart that loaded the change",
    entryPoint: "GET /api/builder/database/reload",
    async run(/** @type {Ctx} */ ctx) {
      const envBefore = envFile(ctx);
      const changedEnv = `${envBefore ?? ""}\n${PROBE}\n`;
      try {
        const loaded = await builder(ctx, "reload with .env as loaded", "GET", "/database/reload");
        writeEnv(ctx, changedEnv);
        const changed = await builder(ctx, "reload after a value changed", "GET", "/database/reload");
        writeEnv(ctx, envBefore);
        const back = await builder(ctx, "reload after the value is back", "GET", "/database/reload");
        await ctx.verify("due follows the file", [
          check("an unchanged .env is not due", loaded.status === 200 && pick(loaded.body, "due") === false, loaded),
          check("a changed value is due", changed.status === 200 && pick(changed.body, "due") === true, changed),
          check("the loaded value back is not due", back.status === 200 && pick(back.body, "due") === false, back),
        ]);

        writeEnv(ctx, changedEnv);
        await ctx.restartBackend();
        const restarted = await builder(ctx, "reload after a restart loaded the change", "GET", "/database/reload");
        writeEnv(ctx, envBefore);
        const reverted = await builder(ctx, "reload once the change is reverted", "GET", "/database/reload");
        await ctx.verify("a restart loads the file again", [
          check("the restarted project loaded the change, so it is not due", restarted.status === 200 && pick(restarted.body, "due") === false, restarted),
          check("reverting what it loaded is due", reverted.status === 200 && pick(reverted.body, "due") === true, reverted),
        ]);
      } finally {
        writeEnv(ctx, envBefore);
        await ctx.restartBackend();
      }
      await ctx.verify("the project is as it was", [check(".env is the same, or still absent", envFile(ctx) === envBefore, envBefore === null ? "absent" : envBefore.length)]);
    },
  },
  {
    id: "a-configuration-it-cannot-rewrite-is-refused-with-422",
    title: "With builder.projectRoot on an antelope.config.ts that keys a module by a computed name, GET /database/project answers 422 refused with a message, and the file is not written",
    entryPoint: "GET /api/builder/database/project with builder.projectRoot set",
    async run(/** @type {Ctx} */ ctx) {
      const root = join(ctx.state.dir, "computed-name-root");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, CONFIG_FILE), COMPUTED_NAME_CONFIG);
      await withConfig(ctx, { VERIFY_BUILDER_PROJECT_ROOT: root }, async () => {
        const project = await builder(ctx, "the project of a configuration with a computed module name", "GET", "/database/project");
        await ctx.verify("the refusals", [
          check("project answers 422 with the refused code", project.status === 422 && text(project.body, "code") === "refused", project),
          check("its message names the computed name", text(project.body, "message").includes("computed name"), project.body),
        ]);
      });
      await ctx.verify("nothing was written", [check("the configuration is byte for byte the same", readFileSync(join(root, CONFIG_FILE), "utf8") === COMPUTED_NAME_CONFIG, root)]);
    },
  },
  ]),
);

/** The user-facing files these journeys cover, as globs relative to the repository root. */
export const covers = [
  "src/builder/routes/database.ts",
  "src/builder/constants/routes.ts",
  "src/builder/dms-answer.ts",
  "src/builder/refusal.ts",
  "src/builder/reload.ts",
  "frontend-vue/builder/app/runtime/**",
];
