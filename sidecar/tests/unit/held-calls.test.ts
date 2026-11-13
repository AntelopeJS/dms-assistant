import { describe, expect, it } from "vitest";
import {
  createHeldCalls,
  type HeldCalls,
  type ToolCallSubject,
} from "../../src/agent/held-calls.js";
import type { RunnerToolResult } from "../../src/agent/runner-events.js";
import {
  coreConfirmationGate,
  SESSION,
} from "../helpers/core-confirmation-gate.js";
import { playTurn, TURN_CONVERSATION_ID } from "../helpers/turn-events.js";

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

function refusalOf(gate: Gate, args: Parameters<Gate["hold"]>[2]): Refusal {
  const refusal = gate.hold(SESSION, "builder_delete_resource", args);
  if (refusal === undefined) throw new Error("the DMS ran a first call");
  return refusal;
}

function heldAfterRefusal(now: () => number = () => 0) {
  const gate = coreConfirmationGate.createRepeatConfirmationGate(now);
  const held = createHeldCalls(now);
  endCall(held, HELD, { result: refusalOf(gate, ARGS).content });
  return { gate, held };
}

describe("held calls, from the DMS's answer", () => {
  it.each(Object.entries(AS_REPORTED_BY))(
    "holds the call the DMS's own gate refused, as %s reports it (fails a detector the DMS's wording or a provider's shape escapes)",
    (_provider, report) => {
      const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
      const held = createHeldCalls(() => 0);
      endCall(held, HELD, { result: report(refusalOf(gate, ARGS)) });
      expect(
        held.isHeld(TURN_CONVERSATION_ID, {
          toolName: DELETE,
          args: { keepData: false, ref: "orders" },
        }),
      ).toBe(true);
    },
  );

  it.each(Object.entries(AS_REPORTED_BY))(
    "holds an answer that ends with the DMS's hold code, whatever its prose, as %s reports it (fails a detector that reads only the prose)",
    (_provider, report) => {
      const held = createHeldCalls(() => 0);
      const content = [
        { type: "text" as const, text: "Reworded: this deletion waits." },
        {
          type: "text" as const,
          text: '{"code":"confirmation_required"}',
        },
      ];
      endCall(held, HELD, { result: report({ content, isError: true }) });
      expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(true);
    },
  );

  it("holds a refusal that carries no code, by its prose, as a DMS released before the code answers (fails a detector with no prose fallback)", () => {
    const held = createHeldCalls(() => 0);
    const prose =
      "builder_delete_resource was not run: no one has confirmed it yet.";
    endCall(held, HELD, { result: [{ type: "text", text: prose }] });
    expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(true);
  });

  it("does not hold the DMS's refusal prose when the answer ends with another code (fails a prose fallback that fires beside a code)", () => {
    const held = createHeldCalls(() => 0);
    const prose =
      "builder_delete_resource was not run: no one has confirmed it yet.";
    endCall(held, HELD, {
      result: [
        { type: "text", text: prose },
        { type: "text", text: '{"code":"invalid_config"}' },
      ],
    });
    expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(false);
  });

  it.each(['{"ok":true}', '{"code":"not_found"}', "not json"])(
    "does not hold an answer that ends with %s (fails a detector that holds any JSON ending)",
    (last) => {
      const held = createHeldCalls(() => 0);
      const content = [
        { type: "text", text: "builder_delete_resource failed." },
        { type: "text", text: last },
      ];
      endCall(held, HELD, { result: content });
      expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(false);
    },
  );
});

describe("held calls, once held", () => {
  it("holds every call to the held tool, whatever its arguments, as the DMS drops the keys its tool does not know (fails a hold keyed on the raw arguments)", () => {
    const { held } = heldAfterRefusal();
    expect(
      held.isHeld(TURN_CONVERSATION_ID, {
        ...HELD,
        args: { ...ARGS, force: true },
      }),
    ).toBe(true);
    expect(
      held.isHeld(TURN_CONVERSATION_ID, {
        ...HELD,
        args: { ref: "customers" },
      }),
    ).toBe(true);
  });

  it("keeps the tool held while another of its calls is held, after one ran (fails a release of the whole tool)", () => {
    const { gate, held } = heldAfterRefusal();
    const otherArgs = { ref: "customers" };
    const other = { toolName: DELETE, args: otherArgs };
    endCall(held, other, { result: refusalOf(gate, otherArgs).content });
    held.observe(TURN_CONVERSATION_ID, HELD, { outcome: "done" });
    expect(
      gate.hold(SESSION, "builder_delete_resource", otherArgs),
    ).toBeUndefined();
    expect(held.isHeld(TURN_CONVERSATION_ID, other)).toBe(true);
  });

  it("keeps the held call after a run with a key the DMS's tool knows, which the DMS ran on another hold (fails a release by argument subset, which skips the card of the call the DMS still holds)", () => {
    const gate = coreConfirmationGate.createRepeatConfirmationGate(() => 0);
    const held = createHeldCalls(() => 0);
    const heldArgs = { ref: "orders" };
    const runArgs = { ref: "orders", keepData: true };
    const heldCall = { toolName: DELETE, args: heldArgs };
    const run = { toolName: DELETE, args: runArgs };
    endCall(held, heldCall, { result: refusalOf(gate, heldArgs).content });
    endCall(held, run, { result: refusalOf(gate, runArgs).content });
    expect(
      gate.hold(SESSION, "builder_delete_resource", runArgs),
    ).toBeUndefined();
    held.observe(TURN_CONVERSATION_ID, run, { outcome: "done" });
    expect(held.holdOf(TURN_CONVERSATION_ID, heldCall)).toEqual({
      preview: heldArgs,
    });
    expect(
      gate.hold(SESSION, "builder_delete_resource", heldArgs),
    ).toBeUndefined();
  });

  it("gives the repeat the DMS's preview, and another call of the tool none (fails a card that shows another call's preview)", () => {
    const { held } = heldAfterRefusal();
    expect(held.holdOf(TURN_CONVERSATION_ID, HELD)).toEqual({ preview: ARGS });
    expect(
      held.holdOf(TURN_CONVERSATION_ID, {
        ...HELD,
        args: { ref: "customers" },
      }),
    ).toEqual({
      preview: undefined,
    });
  });

  it("keeps a hold to its own conversation: another one neither sees it nor releases it (fails a hold the chat keeps for the whole sidecar)", () => {
    const { held } = heldAfterRefusal();
    const other = "conv-other";
    expect(held.isHeld(other, HELD)).toBe(false);
    expect(held.holdOf(other, HELD)).toBeUndefined();
    held.observe(other, HELD, { outcome: "done" });
    expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(true);
  });

  it("counts another tool or server as another call (fails a hold that asks before every DMS tool)", () => {
    const { held } = heldAfterRefusal();
    expect(
      held.isHeld(TURN_CONVERSATION_ID, {
        toolName: "mcp__dms__builder_delete_page",
        args: ARGS,
      }),
    ).toBe(false);
    expect(
      held.isHeld(TURN_CONVERSATION_ID, {
        toolName: "mcp__dms-ai__builder_delete_resource",
        args: ARGS,
      }),
    ).toBe(false);
  });

  it("releases the call once it ran and succeeded, as the DMS consumed its hold (fails a hold kept after a run that succeeded)", () => {
    const { held } = heldAfterRefusal();
    held.observe(TURN_CONVERSATION_ID, HELD, { outcome: "done" });
    expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(false);
  });

  it.each(["failed", "denied", "blocked", "stopped"] as const)(
    "keeps the call held after it ended %s, which may have stopped before the DMS's gate (fails a release that lets the next identical call run unasked)",
    (outcome) => {
      const { held } = heldAfterRefusal();
      held.observe(TURN_CONVERSATION_ID, HELD, { outcome });
      expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(true);
    },
  );

  it("keeps the call held for as long as the DMS runs its repeat (fails a window shorter than the DMS's)", () => {
    let nowMs = 0;
    const { gate, held } = heldAfterRefusal(() => nowMs);
    nowMs = coreConfirmationGate.REPEAT_CONFIRMATION_WINDOW_MS;
    expect(held.isHeld(TURN_CONVERSATION_ID, HELD)).toBe(true);
    expect(gate.hold(SESSION, "builder_delete_resource", ARGS)).toBeUndefined();
  });
});
