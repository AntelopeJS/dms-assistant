import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { CODEX_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  collectUntil,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-codex-usage";
const RUN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

describe("a Codex turn's usage", () => {
  let harness: WsHarness | undefined;
  let client: WebSocket | undefined;

  afterEach(async () => {
    client?.close();
    client = undefined;
    CODEX_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
  });

  it(
    "reports the cached input of the recorded turn as cache reads (fails when Codex's cached input counts as new tokens)",
    async () => {
      CODEX_FIXTURE.use("simple");
      harness = await startWsHarness({ provider: "codex" });
      client = await openChat(harness.port);
      const collected = collectUntil(client, {
        timeoutMs: RUN_TIMEOUT_MS,
        until: (event) => event.type === "usage",
      });
      sendHello(client, CONVERSATION_ID);
      sendUserMessage(client, CONVERSATION_ID, "hello");
      const usage = (await collected).find((event) => event.type === "usage");
      expect(usage).toMatchObject({
        totalTokens: 11_220,
        cacheReadTokens: 11_136,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
