import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import type { ActiveTurn } from "../../src/server/turn-registry.js";
import { turnTypecheck } from "../../src/server/turns.js";
import {
  coreConfirmationGate,
  SESSION,
} from "../helpers/core-confirmation-gate.js";
import { playTurn } from "../helpers/turn-events.js";

const MODULE_FILE = "/proj/modules/mymod/src/a.ts";

function turn(overrides: Partial<ActiveTurn>): ActiveTurn {
  return {
    conversationId: "conv-1",
    request: "Edit",
    isAutoFix: false,
    checkpoint: { ready: async () => {}, finish: async () => null },
    openCalls: new Map(),
    approvalsNeeded: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
    },
    builderOps: 0,
    mutatingCallIds: [],
    ...overrides,
  };
}

describe("turnTypecheck", () => {
  it("counts a turn changed by Builder operations alone as typechecked", () => {
    expect(
      turnTypecheck(turn({ builderOps: 2, mutatingCallIds: ["a", "b"] })),
    ).toBe("passed");
  });

  it("counts a turn whose one deletion the DMS held first as typechecked (fails a held call counted as a mutating one)", () => {
    const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
    const args = { ref: "orders" };
    const answer = (callId: string): RunnerEvent => {
      const refusal = gate.hold(SESSION, "builder_delete_resource", args);
      return {
        type: "tool_result",
        callId,
        result: refusal?.content ?? [{ type: "text", text: '{"ok":true}' }],
        isError: refusal !== undefined,
      };
    };
    const { turn: deleted } = playTurn(
      ["first", "repeat"].flatMap((callId) => [
        {
          type: "tool_use",
          callId,
          toolName: "mcp__dms__builder_delete_resource",
          args,
        },
        answer(callId),
      ]),
    );
    expect([deleted.builderOps, turnTypecheck(deleted)]).toEqual([1, "passed"]);
  });

  it("keeps skipped when a raw edit or a failed operation took part", () => {
    expect(
      turnTypecheck(turn({ builderOps: 1, mutatingCallIds: ["a", "edit"] })),
    ).toBe("skipped");
  });

  it("leaves a turn that edited a module to the safety net, whatever an untargeted typecheck read", () => {
    const { turn: edited } = playTurn([
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
