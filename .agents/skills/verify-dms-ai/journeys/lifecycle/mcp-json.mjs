import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, parseJson, pause, pick, same, statusIs, text, until } from "../../ai.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const DMS_AI_SERVER = { command: "node", args: ["node_modules/.cache/dms-ai/mcp-bridge.cjs"] };
const OTHER_SERVER = { command: "echo", args: ["kept"] };
const SETTLE_MS = 6000;

/** @param {Ctx} ctx */
function projectFile(ctx) {
  return join(ctx.state.runPlayground ?? ctx.state.playground, ".mcp.json");
}

/** @param {Ctx} ctx */
function backendLog(ctx) {
  const log = ctx.state.processes.find((entry) => entry.name === "backend")?.log;
  return log && existsSync(log) ? readFileSync(log, "utf8") : "";
}

/** @param {Ctx} ctx @param {string} body */
async function restartOn(ctx, body) {
  writeFileSync(projectFile(ctx), body);
  await ctx.restartBackend();
  await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
}

export const mcpJsonJourneys = [
  {
    id: "a-development-start-adds-the-dms-server-to-mcp-json-and-keeps-the-rest",
    title: "a development start leaves the dms server in the project's .mcp.json and keeps every other server and key as written, a dms-ai server included, writes nothing on the next start, and leaves a file that is not a JSON object of servers as it is",
    entryPoint: "<project>/.mcp.json, ajs project dev",
    backend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      const logged = (/** @type {RegExp} */ pattern) => until(() => pattern.test(backendLog(ctx)), { timeoutMs: 60_000, everyMs: 500 });
      await restartOn(ctx, `${JSON.stringify({ note: "kept", mcpServers: { "dms-ai": DMS_AI_SERVER, other: OTHER_SERVER } }, null, 2)}\n`);
      await until(() => pick(parseJson(readFileSync(projectFile(ctx), "utf8")), "mcpServers", "dms") !== undefined, { timeoutMs: 60_000, everyMs: 500 });
      const started = parseJson(readFileSync(projectFile(ctx), "utf8"));
      await ctx.verify("after the start", [
        same("the dms, dms-ai and other servers are there", ["dms", "dms-ai", "other"].map((name) => pick(started, "mcpServers", name) !== undefined), [true, true, true]),
        same("the dms-ai server is untouched", pick(started, "mcpServers", "dms-ai"), DMS_AI_SERVER),
        same("the other server is untouched", pick(started, "mcpServers", "other"), OTHER_SERVER),
        same("the other key is kept", pick(started, "note"), "kept"),
        check("the backend logged no removal", !/\.mcp\.json: removed/.test(backendLog(ctx)), "no removal line"),
      ]);
      const written = [statSync(projectFile(ctx)).mtimeMs, readFileSync(projectFile(ctx), "utf8")];
      await ctx.restartBackend();
      await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
      await pause(SETTLE_MS);
      await ctx.verify("the next start", [same("the file is not rewritten", [statSync(projectFile(ctx)).mtimeMs, readFileSync(projectFile(ctx), "utf8")], written)]);
      const unusable = `${JSON.stringify({ mcpServers: ["dms-ai"] })}\n`;
      await restartOn(ctx, unusable);
      const warned = await logged(/\.mcp\.json is not a JSON object with an object of servers, so it was left as it is\./);
      await ctx.verify("a file that is not a JSON object of servers", [
        check("the backend warned", Boolean(warned), String(warned)),
        same("the file is as it was", readFileSync(projectFile(ctx), "utf8"), unusable),
      ]);
    },
  },
];
