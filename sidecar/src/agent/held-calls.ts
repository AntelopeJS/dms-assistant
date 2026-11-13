import { z } from "zod";
import {
  DMS_MCP_HOLD_CODE,
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
  conversationId: string;
  tool: string;
  expiresAtMs: number;
}

/**
 * The DMS MCP's calls held until someone confirms them. The DMS refuses the
 * first such call and runs an identical one repeated within its window, so
 * the chat asks the person before it lets that repeat through. The DMS keeps
 * each hold for the MCP session that was refused, and each conversation runs
 * its own session, so the chat keeps each hold for its conversation: a call
 * in one conversation never records, consults or releases another's hold.
 */
export interface HeldCalls {
  /** A call is held by its `held` outcome and released once it succeeded. */
  observe(conversationId: string, call: ToolCallSubject, end: CallEnd): void;
  /**
   * Whether the call's tool has a held call pending in the conversation,
   * whatever the call's arguments: the DMS drops the arguments its tool does
   * not know before it looks its hold up, so a repeat with another key can
   * still run.
   */
  isHeld(conversationId: string, call: ToolCallSubject): boolean;
  /**
   * The held call this call repeats in the conversation, with the DMS's
   * preview when the arguments are the same, or `undefined` when its tool has
   * none held there.
   */
  holdOf(conversationId: string, call: ToolCallSubject): HeldCall | undefined;
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

function callKey(conversationId: string, call: ToolCallSubject): string {
  return JSON.stringify([
    conversationId,
    bareToolName(call.toolName),
    withSortedKeys(call.args),
  ]);
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

const CodeSchema = z.object({ code: z.string() });

/**
 * The code the answer ends with. The DMS sends it as the last text block, so
 * it is the last line once the blocks are joined, as Claude hands them over.
 */
function endingCodeOf(text: string): string | undefined {
  const lastLine = text.slice(text.lastIndexOf("\n") + 1);
  try {
    return CodeSchema.safeParse(JSON.parse(lastLine)).data?.code;
  } catch {
    return undefined;
  }
}

/**
 * The DMS's refusal of a call it holds until someone confirms it, when the
 * tool's answer is one: read from the code it ends with, or from its prose
 * when it ends with no code at all.
 */
export function holdRefusalOf(
  toolName: string,
  answer: Pick<RunnerToolResult, "result">,
): HeldCall | undefined {
  if (!isDmsTool(toolName)) return undefined;
  const text = AnswerTextSchema.safeParse(answer.result).data ?? "";
  const code = endingCodeOf(text);
  const isRefusal =
    code === undefined
      ? text.startsWith(
          `${bareToolName(toolName)}${DMS_MCP_HOLD_REFUSAL_SUFFIX}`,
        )
      : code === DMS_MCP_HOLD_CODE;
  return isRefusal ? { preview: previewIn(text) } : undefined;
}

/**
 * Whether a call's end releases its hold: only a success does. The DMS
 * consumes its hold once the call passes its gate, but it runs some of its
 * work, such as a preview, before that gate, and a failure reads the same on
 * either side of it. A failure therefore keeps the hold, as does a call that
 * never reached the DMS: declined by the person, blocked or stopped first.
 */
const RELEASED_BY_OUTCOME: Record<Exclude<ToolOutcome, "held">, boolean> = {
  done: true,
  failed: false,
  denied: false,
  blocked: false,
  stopped: false,
};

/**
 * The held calls of every conversation. A refused call stays held for the
 * DMS's whole window, counted from when its refusal arrived, so never for
 * less time than the DMS holds it, and only a success with the same
 * arguments releases it. When the chat cannot tell whether the DMS still
 * holds a call, it asks once more, so these cases cost a question, never a
 * missing one:
 *
 * - An approved repeat that passed the DMS's gate and then failed keeps the
 *   chat's hold, though the DMS consumed its own: the next identical call is
 *   asked, the DMS refuses it, and its repeat is asked again. A marker from
 *   the DMS that a call passed its gate would let that failure release.
 */
export function createHeldCalls(now: () => number = Date.now): HeldCalls {
  const holdByCall = new Map<string, Hold>();
  const dropExpired = (at: number): void => {
    for (const [key, hold] of holdByCall) {
      if (hold.expiresAtMs < at) holdByCall.delete(key);
    }
  };
  const holdOf = (
    conversationId: string,
    call: ToolCallSubject,
  ): HeldCall | undefined => {
    if (!isDmsTool(call.toolName)) return undefined;
    dropExpired(now());
    const same = holdByCall.get(callKey(conversationId, call));
    if (same !== undefined) return { preview: same.preview };
    const tool = bareToolName(call.toolName);
    const isToolHeld = [...holdByCall.values()].some(
      (h) => h.conversationId === conversationId && h.tool === tool,
    );
    return isToolHeld ? { preview: undefined } : undefined;
  };
  return {
    observe(conversationId, call, end) {
      if (!isDmsTool(call.toolName)) return;
      const at = now();
      dropExpired(at);
      const key = callKey(conversationId, call);
      if (end.outcome === "held") {
        holdByCall.set(key, {
          conversationId,
          tool: bareToolName(call.toolName),
          preview: end.preview,
          expiresAtMs: at + DMS_MCP_HOLD_WINDOW_MS,
        });
      } else if (RELEASED_BY_OUTCOME[end.outcome]) {
        holdByCall.delete(key);
      }
    },
    isHeld: (conversationId, call) =>
      holdOf(conversationId, call) !== undefined,
    holdOf,
  };
}
