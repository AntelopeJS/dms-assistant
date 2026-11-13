import { z } from "zod";
import {
  DMS_MCP_HOLD_REFUSAL_SUFFIX,
  DMS_MCP_HOLD_WINDOW_MS,
  DMS_MCP_TOOL_NAME_PREFIX,
} from "../constants/mcp.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";
import type { RunnerToolResult } from "./runner-events.js";
import { bareToolName } from "./tool-kinds.js";

export interface ToolCallSubject {
  toolName: string;
  args: JsonValue;
}

type CallAnswer = Pick<RunnerToolResult, "result" | "isError">;

interface Hold {
  tool: string;
  expiresAtMs: number;
}

/**
 * The DMS MCP's calls held until someone confirms them. The DMS refuses the
 * first such call and runs an identical one repeated within its window, so
 * the chat asks the person before it lets that repeat through. Kept for the
 * whole sidecar, as the DMS keeps them for every session.
 */
export interface HeldCalls {
  /** A held call is recorded by the DMS's refusal and released once it ran. */
  observe(call: ToolCallSubject, answer: CallAnswer): void;
  /**
   * Whether the call's tool has a held call pending, whatever the call's
   * arguments: the DMS drops the arguments its tool does not know before it
   * looks its hold up, so a repeat with another key can still run.
   */
  isHeld(call: ToolCallSubject): boolean;
}

const TextBlockSchema = z.object({ type: z.literal("text"), text: z.string() });

const TextOfBlocksSchema = z
  .array(z.unknown())
  .transform((blocks) =>
    blocks
      .flatMap((block) => TextBlockSchema.safeParse(block).data?.text ?? [])
      .join("\n"),
  );

/**
 * A tool's answer as text: Claude hands the MCP content as a string or its
 * blocks, Codex the MCP result with its `content`, or an error's `message`.
 */
const AnswerTextSchema = z.union([
  z.string(),
  TextOfBlocksSchema,
  z.object({ content: TextOfBlocksSchema }).transform(({ content }) => content),
  z.object({ message: z.string() }).transform(({ message }) => message),
]);

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

function withSortedKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  const object = JsonObjectSchema.safeParse(value);
  if (!object.success) return value;
  return Object.fromEntries(
    Object.entries(object.data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, withSortedKeys(inner)]),
  );
}

function callKey(call: ToolCallSubject): string {
  return `${bareToolName(call.toolName)}\u0000${JSON.stringify(withSortedKeys(call.args))}`;
}

function isDmsTool(call: ToolCallSubject): boolean {
  return call.toolName.startsWith(DMS_MCP_TOOL_NAME_PREFIX);
}

function isHoldRefusal(call: ToolCallSubject, answer: CallAnswer): boolean {
  const text = AnswerTextSchema.safeParse(answer.result).data ?? "";
  return text.startsWith(
    `${bareToolName(call.toolName)}${DMS_MCP_HOLD_REFUSAL_SUFFIX}`,
  );
}

/**
 * A refused call stays held for the DMS's whole window, counted from when its
 * refusal arrived, so never for less time than the DMS holds it. Any other
 * failure, a refusal by the person included, leaves it held: the DMS still
 * runs the next identical call. Only a run with the same arguments releases
 * it, so a run the chat cannot match to it costs one more question, never a
 * missing one.
 */
export function createHeldCalls(now: () => number = Date.now): HeldCalls {
  const holdByCall = new Map<string, Hold>();
  const dropExpired = (at: number): void => {
    for (const [key, hold] of holdByCall) {
      if (hold.expiresAtMs < at) holdByCall.delete(key);
    }
  };
  return {
    observe(call, answer) {
      if (!isDmsTool(call)) return;
      const at = now();
      dropExpired(at);
      if (isHoldRefusal(call, answer)) {
        holdByCall.set(callKey(call), {
          tool: bareToolName(call.toolName),
          expiresAtMs: at + DMS_MCP_HOLD_WINDOW_MS,
        });
      } else if (!answer.isError) {
        holdByCall.delete(callKey(call));
      }
    },
    isHeld(call) {
      if (!isDmsTool(call)) return false;
      dropExpired(now());
      const tool = bareToolName(call.toolName);
      return [...holdByCall.values()].some((hold) => hold.tool === tool);
    },
  };
}
