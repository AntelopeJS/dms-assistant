import {
  type CallEnd,
  type HeldCalls,
  holdRefusalOf,
} from "../agent/held-calls.js";
import type {
  RunnerToolResult,
  RunnerToolUse,
} from "../agent/runner-events.js";
import {
  isBashTool,
  isEditTool,
  isMutatingBuilderTool,
  isMutatingTool,
  isReadOnlyTool,
} from "../agent/tool-kinds.js";
import type { AllowedBy, ToolOutcome } from "../constants/audit.js";
import {
  EVENT_TYPES,
  STATUS,
  type ToolCallEndEventType,
} from "../protocol/events.js";
import { JsonValueSchema } from "../protocol/json.js";
import type { CallAudit, CallDecision } from "../audit/call-audit.js";
import type { ConversationStore } from "../state/conversations.js";
import type { TurnRegistry } from "./turn-registry.js";

/** What starting, ending and stopping a tool call reads and writes. */
export interface ToolCallServices {
  turns: Pick<TurnRegistry, "get">;
  conversationStore: Pick<
    ConversationStore,
    "get" | "appendMessage" | "patchMessages"
  >;
  callAudit: Pick<CallAudit, "lookup">;
  heldCalls: Pick<HeldCalls, "observe">;
}

/**
 * What a call that ran without any recorded decision was allowed by. Claude
 * runs the commands it deems read-only and, in Accept edits, the edits, without
 * asking; Codex runs sandboxed commands the same way.
 */
interface AllowedByMatcher {
  allowedBy: AllowedBy;
  matches: (toolName: string) => boolean;
}

/**
 * Tried in order. The `rule` entry covers edits accepted by the conversation's
 * Accept edits mode, a standing rule.
 */
const DEFAULT_ALLOWED_BY: readonly AllowedByMatcher[] = [
  { allowedBy: "builder_auto", matches: (name) => isMutatingBuilderTool(name) },
  { allowedBy: "read_auto", matches: (name) => isReadOnlyTool(name) },
  { allowedBy: "rule", matches: (name) => isEditTool(name) },
  { allowedBy: "read_auto", matches: (name) => isBashTool(name) },
];

const FALLBACK_ALLOWED_BY: AllowedBy = "read_auto";

const OUTCOME_BY_DECISION: Partial<
  Record<AllowedBy, Exclude<ToolOutcome, "held">>
> = {
  blocked: "blocked",
  denied: "denied",
  auto_denied: "denied",
  expired: "denied",
};

const STOPPED_RESULT = "stopped";

function defaultAllowedBy(toolName: string): AllowedBy {
  return (
    DEFAULT_ALLOWED_BY.find((m) => m.matches(toolName))?.allowedBy ??
    FALLBACK_ALLOWED_BY
  );
}

function decisionOf(
  services: ToolCallServices,
  conversationId: string,
  callId: string,
): CallDecision | undefined {
  return services.callAudit.lookup(conversationId, callId);
}

function endOf(
  ev: RunnerToolResult,
  decision: CallDecision | undefined,
  toolName: string,
): CallEnd {
  if (ev.isStopped === true) return { outcome: "stopped" };
  const decided =
    decision === undefined
      ? undefined
      : OUTCOME_BY_DECISION[decision.allowedBy];
  if (decided !== undefined) return { outcome: decided };
  const held = holdRefusalOf(toolName, ev);
  if (held !== undefined) return { outcome: "held", ...held };
  return { outcome: ev.isError ? "failed" : "done" };
}

/** Persists a call as it starts and tracks it on the running turn. */
export function startToolCall(
  services: ToolCallServices,
  conversationId: string,
  ev: RunnerToolUse,
): void {
  const turn = services.turns.get(conversationId);
  turn?.openCalls.set(ev.callId, {
    toolName: ev.toolName,
    args: ev.args,
    startedAtMs: Date.now(),
  });
  if (turn !== undefined && isMutatingTool(ev.toolName)) {
    turn.mutatingCallIds.push(ev.callId);
  }
  services.conversationStore.appendMessage(conversationId, {
    role: "tool_use",
    content: JSON.stringify(ev.args ?? null),
    toolName: ev.toolName,
    callId: ev.callId,
    allowedBy: decisionOf(services, conversationId, ev.callId)?.allowedBy,
    isAutoFix: turn?.isAutoFix === true ? true : undefined,
    timestampMs: Date.now(),
  });
}

function toolNameOf(
  services: ToolCallServices,
  conversationId: string,
  callId: string,
): string {
  const open = services.turns.get(conversationId)?.openCalls.get(callId);
  if (open !== undefined) return open.toolName;
  const messages = services.conversationStore.get(conversationId)?.messages;
  const stored = [...(messages ?? [])]
    .reverse()
    .find((m) => m.role === "tool_use" && m.callId === callId);
  return stored?.toolName ?? "";
}

function trackEnd(
  services: ToolCallServices,
  conversationId: string,
  ev: RunnerToolResult,
  toolName: string,
  end: CallEnd,
): void {
  const turn = services.turns.get(conversationId);
  if (turn === undefined) return;
  const open = turn.openCalls.get(ev.callId);
  turn.openCalls.delete(ev.callId);
  const args = JsonValueSchema.safeParse(open?.args);
  if (open !== undefined && args.success) {
    services.heldCalls.observe(
      conversationId,
      { toolName: open.toolName, args: args.data },
      end,
    );
  }
  const { outcome } = end;
  if (outcome === "held") {
    turn.mutatingCallIds = turn.mutatingCallIds.filter(
      (callId) => callId !== ev.callId,
    );
  }
  if (outcome === "done" && isMutatingBuilderTool(toolName)) turn.builderOps++;
}

/**
 * Ends a call: works out its outcome and how it was allowed, persists both on
 * the stored result (and the way it was allowed on the stored call), and
 * answers the event the chat is sent.
 */
export function endToolCall(
  services: ToolCallServices,
  conversationId: string,
  ev: RunnerToolResult,
): ToolCallEndEventType {
  const toolName = toolNameOf(services, conversationId, ev.callId);
  const decision = decisionOf(services, conversationId, ev.callId);
  const end = endOf(ev, decision, toolName);
  const { outcome } = end;
  const allowedBy = decision?.allowedBy ?? defaultAllowedBy(toolName);
  trackEnd(services, conversationId, ev, toolName, end);
  const status = ev.isError ? STATUS.ERROR : STATUS.SUCCESS;
  services.conversationStore.patchMessages(
    conversationId,
    (m) => m.role === "tool_use" && m.callId === ev.callId,
    { allowedBy },
  );
  services.conversationStore.appendMessage(conversationId, {
    role: "tool_result",
    content: JSON.stringify(ev.result ?? null),
    callId: ev.callId,
    status,
    outcome,
    allowedBy,
    timestampMs: Date.now(),
  });
  return {
    type: EVENT_TYPES.TOOL_CALL_END,
    conversationId,
    callId: ev.callId,
    status,
    result: ev.result,
    outcome,
    allowedBy,
  };
}

/** The calls a cut-short turn left open, ended as `stopped`. */
export function stopOpenCalls(
  services: ToolCallServices,
  conversationId: string,
): ToolCallEndEventType[] {
  const turn = services.turns.get(conversationId);
  if (turn === undefined) return [];
  return [...turn.openCalls.keys()].map((callId) =>
    endToolCall(services, conversationId, {
      type: "tool_result",
      callId,
      result: STOPPED_RESULT,
      isError: true,
      isStopped: true,
    }),
  );
}
