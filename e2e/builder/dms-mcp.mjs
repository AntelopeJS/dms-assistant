import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

const CALL_TIMEOUT_MS = 120_000;

const AnswerSchema = z.object({ id: z.number(), result: z.unknown().optional(), error: z.unknown().optional() });
const ToolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ text: z.string().optional() })).catch([]),
});

/**
 * @typedef {{ call: (name: string, args: Record<string, unknown>) => Promise<{ isError: boolean, body: unknown }>, close: () => void }} DmsMcp
 */

/**
 * @param {string} text A line or a tool's text content
 * @returns {unknown} Its JSON, or the text when it is not JSON
 */
function parseJson(text) {
  try {
    /** @type {unknown} */
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    return text;
  }
}

/**
 * @param {unknown} result A `tools/call` result
 * @returns {{ isError: boolean, body: unknown }} Its error flag and its first text content, parsed when it is JSON
 */
function toolAnswer(result) {
  const parsed = ToolResultSchema.safeParse(result);
  if (!parsed.success) return { isError: true, body: result };
  return { isError: parsed.data.isError === true, body: parseJson(parsed.data.content[0]?.text ?? "") };
}

/**
 * Starts the DMS MCP server of a project the way a chat session starts it, over stdio with the chat's access, and
 * answers its `tools/call` requests. It imports the sidecar's build when it starts, so loading this module needs none.
 *
 * @param {string} projectRoot The project the DMS wrote its launcher in
 * @param {"safe" | "full"} access The access a chat in Safe or Code mode gives it
 * @returns {Promise<DmsMcp>} The started server
 */
export async function startDmsMcp(projectRoot, access) {
  const { dmsMcpLaunch } = await import("../../sidecar/dist/mcp/dms-server.js");
  const launch = dmsMcpLaunch(projectRoot, access);
  const child = spawn(launch.command, launch.args, { cwd: projectRoot, stdio: ["pipe", "pipe", "inherit"] });
  /** @type {Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>} */
  const pending = new Map();
  let next = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = AnswerSchema.safeParse(parseJson(line));
    if (!message.success) return;
    const waiter = pending.get(message.data.id);
    if (waiter === undefined) return;
    pending.delete(message.data.id);
    if (message.data.error !== undefined) waiter.reject(new Error(JSON.stringify(message.data.error)));
    else waiter.resolve(message.data.result);
  });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`the DMS MCP exited with ${code}`));
    pending.clear();
  });
  /**
   * @param {string} method The JSON-RPC method
   * @param {Record<string, unknown>} params Its params
   * @returns {Promise<unknown>} Its result
   */
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} got no answer in ${CALL_TIMEOUT_MS} ms`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dms-assistant-e2e", version: "0.0.0" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    call: async (name, args) => toolAnswer(await request("tools/call", { name, arguments: args })),
    close: () => child.kill(),
  };
}
