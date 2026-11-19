import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, freshSidecar, sidecarLock, withEnv } from "../../ai.mjs";

/**
 * @typedef {import("../../ai.mjs").Ctx} Ctx
 * @typedef {Record<string, unknown>} SdkMessage
 * @typedef {{ id: string, name: string, input: Record<string, unknown>, result: string }} ScriptedCall
 */

const HOOKS = import.meta.resolve("./mock-claude-hooks.mjs");
const SESSION_ID = "mock-session-e2e";
const MODEL = "claude-mock";

/**
 * @param {Record<string, unknown>} fields The message's own fields
 * @returns {SdkMessage} The message, with the identifiers every SDK message carries
 */
function sdkMessage(fields) {
  return { ...fields, uuid: randomUUID(), session_id: SESSION_ID };
}

/**
 * @param {Record<string, unknown>[]} content The content blocks
 * @param {string} stopReason Why the model stopped
 * @returns {SdkMessage} An assistant message
 */
function assistant(content, stopReason) {
  return sdkMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: MODEL, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 }, content },
  });
}

/**
 * The SDK messages of one Claude turn, in the shape `@anthropic-ai/claude-agent-sdk` streams them: the session's
 * init, each tool call with its result, the reply streamed chunk by chunk and then whole, and the result with the
 * tokens the turn cost.
 *
 * @param {{ calls?: ScriptedCall[], reply: string[], usage: { input: number, output: number } }} turn What Claude does
 * @returns {SdkMessage[]} The script the fake provider replays
 */
export function scriptedTurn(turn) {
  const text = turn.reply.join("");
  return [
    sdkMessage({ type: "system", subtype: "init", apiKeySource: "user", claude_code_version: "0.0.0-mock", cwd: "/mock", tools: ["Read", "Edit", "Write"], mcp_servers: [], model: MODEL, permissionMode: "default", slash_commands: [], output_style: "default", skills: [], plugins: [], agents: [] }),
    ...(turn.calls ?? []).flatMap((call) => [
      assistant([{ type: "tool_use", id: call.id, name: call.name, input: call.input }], "tool_use"),
      sdkMessage({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: call.result, is_error: false }] } }),
    ]),
    ...turn.reply.map((chunk) => sdkMessage({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } } })),
    assistant([{ type: "text", citations: null, text }], "end_turn"),
    sdkMessage({
      type: "result",
      subtype: "success",
      duration_ms: 250,
      duration_api_ms: 200,
      is_error: false,
      num_turns: 1,
      result: text,
      stop_reason: "end_turn",
      total_cost_usd: 0,
      usage: { input_tokens: turn.usage.input, output_tokens: turn.usage.output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
    }),
  ];
}

/**
 * Runs `body` with the backend's sidecar on the fake Claude provider replaying `script`, from a fresh sidecar:
 * `MOCK_CLAUDE=1` makes the sidecar load `sidecar/tests/fixtures/mock-claude` in place of the agent SDK. The fixture
 * is TypeScript and the run's sidecar is `sidecar/dist`, so the backend starts with `mock-claude-hooks.mjs`
 * preloaded, which resolves the fixture's `.js` imports to its `.ts` sources for Node's type stripping, and the
 * sidecar inherits it. The script is written into the step's evidence. The backend gets its own environment back
 * afterwards.
 *
 * @param {Ctx} ctx The journey
 * @param {SdkMessage[]} script What Claude streams for each turn
 * @param {() => Promise<void>} body What to do with it
 * @returns {Promise<void>}
 */
export async function withMockClaude(ctx, script, body) {
  const file = join(ctx.step("the turn the fake Claude provider replays"), "script.json");
  writeFileSync(file, `${JSON.stringify(script, null, 2)}\n`);
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${HOOKS}`].filter(Boolean).join(" ");
  await withEnv(ctx, { MOCK_CLAUDE: "1", MOCK_CLAUDE_SCRIPT: file, NODE_OPTIONS: nodeOptions }, async () => {
    await freshSidecar(ctx);
    const lock = sidecarLock(ctx);
    const environ = lock ? readFileSync(`/proc/${lock.pid}/environ`, "utf8").split("\0") : [];
    await ctx.verify(
      "the sidecar runs the fake Claude provider",
      [check("the sidecar inherited MOCK_CLAUDE=1 and the script", environ.includes("MOCK_CLAUDE=1") && environ.includes(`MOCK_CLAUDE_SCRIPT=${file}`), environ.filter((entry) => entry.startsWith("MOCK_")))],
      { critical: true },
    );
    await body();
  });
}
