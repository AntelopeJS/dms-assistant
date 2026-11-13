import { describe, expect, it } from "vitest";
import { createHeldCalls } from "../../src/agent/held-calls.js";
import { PERMISSION_DENIED_MESSAGE } from "../../src/constants/permissions.js";
import { coreConfirmationGate } from "../helpers/core-confirmation-gate.js";
import { playTurn } from "../helpers/turn-events.js";

const DELETE = "mcp__dms__builder_delete_resource";
const ARGS = { ref: "orders", keepData: false };
const HELD = { toolName: DELETE, args: ARGS };

function refusedByCore(now: () => number = () => 0) {
  const gate = coreConfirmationGate.createRepeatConfirmationGate(now);
  const refusal = gate.hold("builder_delete_resource", ARGS);
  if (refusal === undefined) throw new Error("the DMS ran a first call");
  return { gate, refusal };
}

type Refusal = ReturnType<typeof refusedByCore>["refusal"];

const AS_REPORTED_BY = {
  claude: (refusal: Refusal) => refusal.content,
  codex: (refusal: Refusal) => ({
    content: refusal.content,
    structuredContent: null,
    _meta: null,
  }),
};

function heldAfterRefusal(now: () => number = () => 0) {
  const { gate, refusal } = refusedByCore(now);
  const held = createHeldCalls(now);
  held.observe(HELD, { result: refusal.content, isError: true });
  return { gate, held };
}

describe("held calls", () => {
  it.each(Object.entries(AS_REPORTED_BY))(
    "holds the call the DMS's own gate refused, as %s reports it (fails a detector the DMS's wording or a provider's shape escapes)",
    (_provider, report) => {
      const { refusal } = refusedByCore();
      const held = createHeldCalls(() => 0);
      held.observe(HELD, { result: report(refusal), isError: true });
      expect(
        held.isHeld({
          toolName: DELETE,
          args: { keepData: false, ref: "orders" },
        }),
      ).toBe(true);
    },
  );

  it("counts another argument, tool or server as another call (fails a key on the tool alone)", () => {
    const { held } = heldAfterRefusal();
    expect(held.isHeld({ ...HELD, args: { ...ARGS, keepData: true } })).toBe(
      false,
    );
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
    held.observe(HELD, {
      result: [{ type: "text", text: '{"ok":true}' }],
      isError: false,
    });
    expect(held.isHeld(HELD)).toBe(false);
  });

  it("keeps the call held after the person declined it (fails a release that lets the next identical call run unasked)", () => {
    const { held } = heldAfterRefusal();
    held.observe(HELD, { result: PERMISSION_DENIED_MESSAGE, isError: true });
    expect(held.isHeld(HELD)).toBe(true);
  });

  it("keeps the call held for as long as the DMS runs its repeat (fails a window shorter than the DMS's)", () => {
    let nowMs = 0;
    const { gate, held } = heldAfterRefusal(() => nowMs);
    nowMs = coreConfirmationGate.REPEAT_CONFIRMATION_WINDOW_MS;
    expect(held.isHeld(HELD)).toBe(true);
    expect(gate.hold("builder_delete_resource", ARGS)).toBeUndefined();
  });

  it("learns the hold from the turn's tool results (fails a server that never tells the held calls)", () => {
    const { refusal } = refusedByCore();
    const { heldCalls } = playTurn([
      { type: "tool_use", callId: "first", toolName: DELETE, args: ARGS },
      {
        type: "tool_result",
        callId: "first",
        result: refusal.content,
        isError: true,
      },
    ]);
    expect(heldCalls.isHeld(HELD)).toBe(true);
  });
});
