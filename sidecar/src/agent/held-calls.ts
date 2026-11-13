import { z } from "zod";
import {
  DMS_MCP_HOLD_PREVIEW_PREFIX,
  DMS_MCP_HOLD_REFUSAL_SUFFIX,
  DMS_MCP_HOLD_WINDOW_MS,
  DMS_MCP_TOOL_NAME_PREFIX,
} from "../constants/mcp.js";
import type { ToolOutcome } from "../constants/audit.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";
import type { RunnerToolResult } from "./runner-events.js";
import { bareToolName } from "./tool-kinds.js";

export interface ToolCallSubject {
  toolName: string;
  args: JsonValue;
}

/**
 * A call the DMS holds: what it showed of the call in its refusal, its
 * arguments with what the builder worked out, such as a configuration diff or
 * the pages a mapping removes. Absent when the refusal shows none, or for
 * another call of a held tool.
 */
export interface HeldCall {
  preview: JsonValue | undefined;
}

/** How a call ended, as the held calls read it: a held one with its preview. */
export type CallEnd =
  | ({ outcome: "held" } & HeldCall)
  | { outcome: Exclude<ToolOutcome, "held"> };

interface Hold extends HeldCall {
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
  /** A call is held by its `held` outcome and released once it ran, success or failure. */
  observe(call: ToolCallSubject, end: CallEnd): void;
  /**
   * Whether the call's tool has a held call pending, whatever the call's
   * arguments: the DMS drops the arguments its tool does not know before it
   * looks its hold up, so a repeat with another key can still run.
   */
  isHeld(call: ToolCallSubject): boolean;
  /**
   * The held call this call repeats, with the DMS's preview when the
   * arguments are the same, or `undefined` when its tool has none held.
   */
  holdOf(call: ToolCallSubject): HeldCall | undefined;
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

function isDmsTool(toolName: string): boolean {
  return toolName.startsWith(DMS_MCP_TOOL_NAME_PREFIX);
}

function previewIn(text: string): JsonValue | undefined {
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith(DMS_MCP_HOLD_PREVIEW_PREFIX));
  if (line === undefined) return undefined;
  try {
    return JsonValueSchema.parse(
      JSON.parse(line.slice(DMS_MCP_HOLD_PREVIEW_PREFIX.length)),
    );
  } catch {
    return undefined;
  }
}

/** The DMS's refusal of a call it holds until someone confirms it, when the tool's answer is one. */
export function holdRefusalOf(
  toolName: string,
  answer: Pick<RunnerToolResult, "result">,
): HeldCall | undefined {
  if (!isDmsTool(toolName)) return undefined;
  const text = AnswerTextSchema.safeParse(answer.result).data ?? "";
  const isRefusal = text.startsWith(
    `${bareToolName(toolName)}${DMS_MCP_HOLD_REFUSAL_SUFFIX}`,
  );
  return isRefusal ? { preview: previewIn(text) } : undefined;
}

/**
 * Whether a call's end releases its hold. The DMS consumes its hold once the
 * call ran, whether it then succeeded or failed. A call that never reached the
 * DMS, declined by the person, blocked or stopped first, leaves it held, as
 * the DMS still runs the next identical call.
 */
const RELEASED_BY_OUTCOME: Record<Exclude<ToolOutcome, "held">, boolean> = {
  done: true,
  failed: true,
  denied: false,
  blocked: false,
  stopped: false,
};

/**
 * A refused call stays held for the DMS's whole window, counted from when its
 * refusal arrived, so never for less time than the DMS holds it. Only a run
 * with the same arguments releases it, so a run the chat cannot match to it
 * costs one more question, never a missing one.
 */
export function createHeldCalls(now: () => number = Date.now): HeldCalls {
  const holdByCall = new Map<string, Hold>();
  const dropExpired = (at: number): void => {
    for (const [key, hold] of holdByCall) {
      if (hold.expiresAtMs < at) holdByCall.delete(key);
    }
  };
  const holdOf = (call: ToolCallSubject): HeldCall | undefined => {
    if (!isDmsTool(call.toolName)) return undefined;
    dropExpired(now());
    const same = holdByCall.get(callKey(call));
    if (same !== undefined) return { preview: same.preview };
    const tool = bareToolName(call.toolName);
    const isToolHeld = [...holdByCall.values()].some((h) => h.tool === tool);
    return isToolHeld ? { preview: undefined } : undefined;
  };
  return {
    observe(call, end) {
      if (!isDmsTool(call.toolName)) return;
      const at = now();
      dropExpired(at);
      if (end.outcome === "held") {
        holdByCall.set(callKey(call), {
          tool: bareToolName(call.toolName),
          preview: end.preview,
          expiresAtMs: at + DMS_MCP_HOLD_WINDOW_MS,
        });
      } else if (RELEASED_BY_OUTCOME[end.outcome]) {
        holdByCall.delete(callKey(call));
      }
    },
    isHeld: (call) => holdOf(call) !== undefined,
    holdOf,
  };
}
