import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openChat,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 3;
const SET_ASIDE_ID = "conv-full-auto";
const DANA = { userId: "u-dana", name: "Dana" };
const REFUSAL =
  "This conversation was saved by another version of the assistant and cannot be continued. Start a new conversation.";

const STORED_STATE = JSON.stringify({
  conversations: {
    [SET_ASIDE_ID]: {
      ownerId: "u-camille",
      messages: [
        {
          role: "tool_result",
          content: "",
          toolName: "Bash",
          callId: "call-1",
          outcome: "done",
          allowedBy: "full_auto",
          timestampMs: 1,
        },
      ],
      createdAtMs: 1,
      updatedAtMs: 2,
    },
  },
});

let harness: WsHarness | undefined;
let sockets: WebSocket[] = [];

describe("a chat on a conversation set aside on load", () => {
  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets = [];
    await harness?.close();
    harness = undefined;
  });

  it(
    "is refused with a reason that asks for a new conversation, and creates nothing under the id (fails a chat that reuses the id)",
    async () => {
      CLAUDE_FIXTURE.use("plain");
      harness = await startWsHarness({
        provider: CLAUDE_FIXTURE.name,
        storedState: STORED_STATE,
      });
      const socket = await openChat(harness.port);
      sockets.push(socket);
      const frames = createCollector(socket, WAIT_MS);
      sendWire(socket, { type: "actor", ...DANA });
      sendHello(socket, SET_ASIDE_ID);
      const refused = frames.next(
        (msg) => msg.type === "run_error" && msg.error === REFUSAL,
      );
      sendUserMessage(socket, SET_ASIDE_ID, "dana's request");
      await refused;
      expect(harness.conversationStore.get(SET_ASIDE_ID)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
