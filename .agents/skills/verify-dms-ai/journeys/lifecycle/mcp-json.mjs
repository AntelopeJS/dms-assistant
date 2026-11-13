import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, parseJson, pause, pick, same, statusIs, text, until } from "../../ai.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const OLD_SERVER = { command: "node", args: ["node_modules/.cache/dms-ai/mcp-bridge.cjs"] };
const OTHER_SERVER = { command: "echo", args: ["kept"] };
const OWN_SERVER = { command: "node", args: ["tools/dms-ai.cjs"] };
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
    id: "a-development-start-replaces-the-old-dms-ai-server-in-mcp-json",
    title: "the first development start after an upgrade removes the dms-ai server the previous version added to .mcp.json, whose launcher is gone, keeps every other server and key, leaves the dms server in place, writes nothing on the next start, keeps a dms-ai server of the owner's own whose launcher is another, and leaves a file that is not a JSON object of servers as it is",
    entryPoint: "<project>/.mcp.json, ajs project dev",
    backend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      const logged = (/** @type {RegExp} */ pattern) => until(() => pattern.test(backendLog(ctx)), { timeoutMs: 60_000, everyMs: 500 });
      await restartOn(ctx, `${JSON.stringify({ note: "kept", mcpServers: { "dms-ai": OLD_SERVER, other: OTHER_SERVER } }, null, 2)}\n`);
      const removed = await logged(/\.mcp\.json: removed the dms-ai server/);
      const upgraded = parseJson(readFileSync(projectFile(ctx), "utf8"));
      await ctx.verify("after the upgrade", [
        check("the backend logged the removal", Boolean(removed), String(removed)),
        same("the old server is gone, the other and the dms server are there", ["dms", "dms-ai", "other"].map((name) => pick(upgraded, "mcpServers", name) !== undefined), [true, false, true]),
        same("the other server is untouched", pick(upgraded, "mcpServers", "other"), OTHER_SERVER),
        same("the other key is kept", pick(upgraded, "note"), "kept"),
      ]);
      const written = [statSync(projectFile(ctx)).mtimeMs, readFileSync(projectFile(ctx), "utf8")];
      await ctx.restartBackend();
      await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
      await pause(SETTLE_MS);
      await ctx.verify("the next start", [same("the file is not rewritten", [statSync(projectFile(ctx)).mtimeMs, readFileSync(projectFile(ctx), "utf8")], written)]);
      const own = `${JSON.stringify({ mcpServers: { "dms-ai": OWN_SERVER, dms: pick(upgraded, "mcpServers", "dms") } }, null, 2)}\n`;
      await restartOn(ctx, own);
      await pause(SETTLE_MS);
      await ctx.verify("a dms-ai server of the owner's own", [same("the file is as it was", readFileSync(projectFile(ctx), "utf8"), own)]);
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
