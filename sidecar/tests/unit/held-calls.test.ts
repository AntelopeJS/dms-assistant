import { describe, expect, it } from "vitest";
import {
  createHeldCalls,
  type HeldCalls,
  type ToolCallSubject,
} from "../../src/agent/held-calls.js";
import type { RunnerToolResult } from "../../src/agent/runner-events.js";
import { coreConfirmationGate } from "../helpers/core-confirmation-gate.js";
import { playTurn } from "../helpers/turn-events.js";

const DELETE = "mcp__dms__builder_delete_resource";
const ARGS = { ref: "orders", keepData: false };
const HELD = { toolName: DELETE, args: ARGS };

type Gate = ReturnType<
  typeof coreConfirmationGate.createRepeatConfirmationGate
>;
type Refusal = NonNullable<ReturnType<Gate["hold"]>>;

const AS_REPORTED_BY = {
  claude: (refusal: Refusal) => refusal.content,
  codex: (refusal: Refusal) => ({
    content: refusal.content,
    structuredContent: null,
    _meta: null,
  }),
};

/** One call through the server's turn events, answered by `answer`. */
function endCall(
  heldCalls: HeldCalls,
  call: ToolCallSubject,
  answer: Pick<RunnerToolResult, "result">,
): void {
  playTurn(
    [
      {
        type: "tool_use",
        callId: "call",
        toolName: call.toolName,
        args: call.args,
      },
      { type: "tool_result", callId: "call", ...answer, isError: true },
    ],
    heldCalls,
  );
}

function refusalOf(gate: Gate, args: Parameters<Gate["hold"]>[1]): Refusal {
  const refusal = gate.hold("builder_delete_resource", args);
  if (refusal === undefined) throw new Error("the DMS ran a first call");
  return refusal;
}

function heldAfterRefusal(now: () => number = () => 0) {
  const gate = coreConfirmationGate.createRepeatConfirmationGate(now);
  const held = createHeldCalls(now);
  endCall(held, HELD, { result: refusalOf(gate, ARGS).content });
  return { gate, held };
}

describe("held calls", () => {
  it.each(Object.entries(AS_REPORTED_BY))(
    "holds the call the DMS's own gate refused, as %s reports it (fails a detector the DMS's wording or a provider's shape escapes)",
    (_provider, report) => {
      const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
      const held = createHeldCalls(() => 0);
      endCall(held, HELD, { result: report(refusalOf(gate, ARGS)) });
      expect(
        held.isHeld({
          toolName: DELETE,
          args: { keepData: false, ref: "orders" },
        }),
      ).toBe(true);
    },
  );

  it("holds every call to the held tool, whatever its arguments, as the DMS drops the keys its tool does not know (fails a hold keyed on the raw arguments)", () => {
    const { held } = heldAfterRefusal();
    expect(held.isHeld({ ...HELD, args: { ...ARGS, force: true } })).toBe(true);
    expect(held.isHeld({ ...HELD, args: { ref: "customers" } })).toBe(true);
  });

  it("keeps the tool held while another of its calls is held, after one ran (fails a release of the whole tool)", () => {
    const { gate, held } = heldAfterRefusal();
    const otherArgs = { ref: "customers" };
    const other = { toolName: DELETE, args: otherArgs };
    endCall(held, other, { result: refusalOf(gate, otherArgs).content });
    held.observe(HELD, "done");
    expect(gate.hold("builder_delete_resource", otherArgs)).toBeUndefined();
    expect(held.isHeld(other)).toBe(true);
  });

  it("counts another tool or server as another call (fails a hold that asks before every DMS tool)", () => {
    const { held } = heldAfterRefusal();
    expect(
      held.isHeld({ toolName: "mcp__dms__builder_delete_page", args: ARGS }),
    ).toBe(false);
    expect(
      held.isHeld({
        toolName: "mcp__dms-ai__builder_delete_resource",
        args: ARGS,
      }),
    ).toBe(false);
  });

  it("releases the call once it ran (fails a hold that makes the next identical call ask twice)", () => {
    const { held } = heldAfterRefusal();
    held.observe(HELD, "done");
    expect(held.isHeld(HELD)).toBe(false);
  });

  it("keeps the call held after the person declined it (fails a release that lets the next identical call run unasked)", () => {
    const { held } = heldAfterRefusal();
    held.observe(HELD, "denied");
    expect(held.isHeld(HELD)).toBe(true);
  });

  it("keeps the call held for as long as the DMS runs its repeat (fails a window shorter than the DMS's)", () => {
    let nowMs = 0;
    const { gate, held } = heldAfterRefusal(() => nowMs);
    nowMs = coreConfirmationGate.REPEAT_CONFIRMATION_WINDOW_MS;
    expect(held.isHeld(HELD)).toBe(true);
    expect(gate.hold("builder_delete_resource", ARGS)).toBeUndefined();
  });
});
