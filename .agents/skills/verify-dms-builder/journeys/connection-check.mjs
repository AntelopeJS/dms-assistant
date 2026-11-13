import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { builder, check, isText, pick, text } from "../builder.mjs";

/** @typedef {import("../builder.mjs").Ctx} Ctx */

const CHECK = "/database/connections/check";
const PASSWORD = "s3cret-verify-password";

/**
 * The URL of the run's own mongod, a MongoDB the check can reach.
 *
 * @param {Ctx} ctx The journey
 * @returns {string} A connection URL for a database of that server
 */
function runMongoUrl(ctx) {
  /** @type {unknown} */
  const run = JSON.parse(readFileSync(join(ctx.state.dir, "run.json"), "utf8"));
  return `${text(run, "mongoUrl")}/verify_connection_check`;
}

export const journeys = guarded([
  {
    id: "the-check-refuses-the-owner-outside-development",
    title: "Under ajs project start POST /database/connections/check answers the owner 403 forbidden, for a good body and a bad one alike, and never repeats the URL",
    entryPoint: "POST /api/builder/database/connections/check",
    async run(/** @type {Ctx} */ ctx) {
      const good = await builder(ctx, "check a reachable database", "POST", CHECK, { body: { engine: "mongodb", url: runMongoUrl(ctx) } });
      const bad = await builder(ctx, "check a body that is not an engine and a URL", "POST", CHECK, { body: { engine: "mysql", url: `mysql://root:${PASSWORD}@127.0.0.1/x` } });
      await ctx.verify("the owner is refused", [
        check("a good body is 403 with the forbidden code", good.status === 403 && text(good.body, "code") === "forbidden", good),
        check("the message says development only", /development only/i.test(text(good.body, "message")), good.body),
        check("a bad body is 403 too, the development check comes first", bad.status === 403 && text(bad.body, "code") === "forbidden", bad),
        check("no answer repeats the URL or its password", ![good, bad].some((answer) => JSON.stringify(answer.body).includes(PASSWORD) || JSON.stringify(answer.body).includes("mongodb://")), [good.body, bad.body]),
      ]);
    },
  },
  {
    id: "the-check-validates-the-body-and-reaches-the-database-in-development",
    title: "Under ajs project dev the check answers 400 for an engine or URL it does not accept without echoing the URL, reaches the run's MongoDB with read and write access, and reports an unreachable one with a reason that holds no password",
    entryPoint: "POST /api/builder/database/connections/check",
    backend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      const engine = await builder(ctx, "an engine it does not connect", "POST", CHECK, { body: { engine: "mysql", url: `mysql://root:${PASSWORD}@127.0.0.1/x` } });
      const scheme = await builder(ctx, "a URL of another engine", "POST", CHECK, { body: { engine: "mongodb", url: `postgres://root:${PASSWORD}@127.0.0.1/x` } });
      const missing = await builder(ctx, "no URL", "POST", CHECK, { body: { engine: "postgres" } });
      await ctx.verify("a body it does not accept", [
        check("an unknown engine is 400 bad_request", engine.status === 400 && text(engine.body, "code") === "bad_request", engine),
        check("the message names the engines it connects", ["postgres", "mongodb", "rethinkdb"].every((name) => text(engine.body, "message").includes(name)), engine.body),
        check("the message names the field to fix", text(engine.body, "message").includes("engine"), engine.body),
        check("a URL of another engine is 400 and names the url field", scheme.status === 400 && text(scheme.body, "message").includes("url"), scheme),
        check("a missing URL is 400", missing.status === 400 && text(missing.body, "code") === "bad_request", missing),
        check("no refusal repeats the password", [engine, scheme, missing].every((answer) => !JSON.stringify(answer.body).includes(PASSWORD)), [engine.body, scheme.body]),
      ]);

      const reachable = await builder(ctx, "check the run's MongoDB", "POST", CHECK, { body: { engine: "mongodb", url: runMongoUrl(ctx) } });
      await ctx.verify("a reachable database", [
        check("the check is a 200", reachable.status === 200, reachable),
        check("reachable is true", pick(reachable.body, "reachable") === true, reachable.body),
        check("it measured a round trip", Number.isFinite(pick(reachable.body, "latencyMs")), reachable.body),
        check("the account can read and, with no access control, write", pick(reachable.body, "canRead") === true && pick(reachable.body, "canWrite") === true, reachable.body),
      ]);

      const down = await builder(ctx, "check a MongoDB nothing listens on", "POST", CHECK, { body: { engine: "mongodb", url: `mongodb://nobody:${PASSWORD}@127.0.0.1:1/x` } });
      const reason = pick(down.body, "reason");
      await ctx.verify("an unreachable database", [
        check("the answer is a 200 with reachable false", down.status === 200 && pick(down.body, "reachable") === false, down),
        check("it carries a reason", isText(reason) && reason.length > 0, down.body),
        check("the reason holds neither the password nor the URL", !JSON.stringify(down.body).includes(PASSWORD) && !JSON.stringify(down.body).includes("mongodb://"), down.body),
        check("it grants no access", pick(down.body, "canRead") !== true && pick(down.body, "canWrite") !== true, down.body),
      ]);
    },
  },
]);
