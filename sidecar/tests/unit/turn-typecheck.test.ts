import { describe, expect, it } from "vitest";
import { createEditTracker } from "../../src/agent/edit-tracker.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import {
  createTurnRegistry,
  type ActiveTurn,
} from "../../src/server/turn-registry.js";
import {
  handleTurnEvent,
  type TurnEventServices,
  turnTypecheck,
} from "../../src/server/turns.js";

const CONVERSATION_ID = "conv-1";
const MODULE_FILE = "/proj/modules/mymod/src/a.ts";

function turn(overrides: Partial<ActiveTurn>): ActiveTurn {
  return {
    conversationId: CONVERSATION_ID,
    request: "Edit",
    isAutoFix: false,
    checkpoint: { ready: async () => {}, finish: async () => null },
    openCalls: new Map(),
    approvalsNeeded: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    builderOps: 0,
    mutatingCallIds: [],
    ...overrides,
  };
}

function runTurn(events: readonly RunnerEvent[]): ActiveTurn {
  const turns = createTurnRegistry();
  const running = turns.begin({
    conversationId: CONVERSATION_ID,
    request: "Edit",
    isAutoFix: false,
    checkpoint: { ready: async () => {}, finish: async () => null },
  });
  const ignore = () => {};
  const services: TurnEventServices = {
    turns,
    editTracker: createEditTracker(),
    conversationStore: {
      get: () => null,
      appendMessage: ignore,
      patchMessages: ignore,
    },
    callAudit: { lookup: () => undefined },
    chatSocketRegistry: { send: ignore },
    liveTurns: { append: ignore, end: ignore },
    permissionBus: { cancelCall: ignore, cancelConversation: ignore },
    questionBus: { cancelCall: ignore, cancelConversation: ignore },
  };
  for (const ev of events) handleTurnEvent(services, CONVERSATION_ID, ev);
  return running;
}

describe("turnTypecheck", () => {
  it("counts a turn changed by Builder operations alone as typechecked", () => {
    expect(
      turnTypecheck(turn({ builderOps: 2, mutatingCallIds: ["a", "b"] })),
    ).toBe("passed");
  });

  it("keeps skipped when a raw edit or a failed operation took part", () => {
    expect(
      turnTypecheck(turn({ builderOps: 1, mutatingCallIds: ["a", "edit"] })),
    ).toBe("skipped");
  });

  it("leaves a turn that edited a module to the safety net, whatever an untargeted typecheck read", () => {
    const edited = runTurn([
      {
        type: "tool_use",
        callId: "edit",
        toolName: "Edit",
        args: { file_path: MODULE_FILE, old_string: "1", new_string: '"x"' },
      },
      { type: "tool_result", callId: "edit", result: "ok", isError: false },
      {
        type: "tool_use",
        callId: "typecheck",
        toolName: "mcp__dms__typecheck",
        args: {},
      },
      {
        type: "tool_result",
        callId: "typecheck",
        result: [{ type: "text", text: "No type errors." }],
        isError: false,
      },
    ]);
    expect(turnTypecheck(edited)).toBe("skipped");
  });
});
