import { createEditTracker } from "../../src/agent/edit-tracker.js";
import { createHeldCalls, type HeldCalls } from "../../src/agent/held-calls.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import {
  type ActiveTurn,
  createTurnRegistry,
} from "../../src/server/turn-registry.js";
import {
  handleTurnEvent,
  type TurnEventServices,
} from "../../src/server/turns.js";

export const TURN_CONVERSATION_ID = "conv-turn-events";

interface PlayedTurn {
  turn: ActiveTurn;
  heldCalls: HeldCalls;
}

/**
 * Runs a provider's events through the server's turn handling, with the turn
 * registry, edit tracker and held calls it really uses, and answers what the
 * turn and the held calls recorded.
 */
export function playTurn(
  events: readonly RunnerEvent[],
  heldCalls: HeldCalls = createHeldCalls(),
): PlayedTurn {
  const turns = createTurnRegistry();
  const turn = turns.begin({
    conversationId: TURN_CONVERSATION_ID,
    request: "Edit",
    isAutoFix: false,
    checkpoint: { ready: async () => {}, finish: async () => null },
  });
  const ignore = () => {};
  const services: TurnEventServices = {
    turns,
    editTracker: createEditTracker(),
    heldCalls,
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
  for (const ev of events) {
    handleTurnEvent(services, TURN_CONVERSATION_ID, ev);
  }
  return { turn, heldCalls };
}
