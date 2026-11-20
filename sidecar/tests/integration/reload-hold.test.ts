import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import type { RunnerContext } from "../../src/agent/runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import type { SidecarServices } from "../../src/server/services.js";
import { runTurnWithHealing } from "../../src/server/turns.js";
import { defer } from "../helpers/deferred.js";
import {
  type FakeReloadHost,
  type FakeWatcher,
  startFakeReloadHost,
} from "../helpers/fake-reload-host.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  interruptTurn,
  openChat,
  requireValue,
  sendHello,
  sendWire,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const TEST_TIMEOUT_MS = WAIT_MS * 3;
const CONVERSATION = "conv-build-it";
const WRITES = 5;
const BUILDER_WRITE = "mcp__dms__builder_add_block";
const LIVE_READ = "mcp__dms__page_verify";

let harness: WsHarness | undefined;
let sockets: WebSocket[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets) socket.close();
  sockets = [];
  await harness?.close();
  harness = undefined;
});

interface Running {
  harness: WsHarness;
  services: SidecarServices;
  host: FakeReloadHost;
  watcher: FakeWatcher;
}

/** Resolves once the sidecar has processed everything the socket sent before. */
async function settled(socket: WebSocket): Promise<void> {
  const frames = createCollector(socket, WAIT_MS);
  sendWire(socket, { type: "echo", payload: "settled" });
  await frames.next((msg) => msg.type === "echo_reply");
}

async function start(): Promise<Running> {
  CLAUDE_FIXTURE.use("plain");
  const running = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
  harness = running;
  const host = await startFakeReloadHost(running.port);
  sockets.push(host.socket);
  await settled(host.socket);
  return {
    harness: running,
    services: requireValue(running.bridge.services),
    host,
    watcher: host.watcher,
  };
}

type TurnScript = (
  ctx: RunnerContext,
  watcher: FakeWatcher,
) => AsyncGenerator<RunnerEvent>;

let callCount = 0;

/** One builder write the way a real tool call runs: the hook, then the tool. */
async function* builderWrite(
  ctx: RunnerContext,
  watcher: FakeWatcher,
): AsyncGenerator<RunnerEvent> {
  callCount += 1;
  const callId = `call-${callCount}`;
  yield { type: "tool_use", callId, toolName: BUILDER_WRITE, args: {} };
  await ctx.beforeMutation?.();
  watcher.write();
  yield { type: "tool_result", callId, result: "ok", isError: false };
}

async function* builderWrites(
  ctx: RunnerContext,
  watcher: FakeWatcher,
  count: number,
): AsyncGenerator<RunnerEvent> {
  for (let i = 0; i < count; i++) yield* builderWrite(ctx, watcher);
}

function runScript(running: Running, script: TurnScript): Promise<void> {
  vi.spyOn(running.services.runner, "start").mockImplementation((_, ctx) =>
    script(ctx, running.watcher),
  );
  return runTurnWithHealing(running.services, {
    conversationId: CONVERSATION,
    content: "build it",
    request: "build it",
    isAutoFix: false,
  });
}

describe("the reload host's socket", () => {
  it(
    "does not keep the sidecar from idling out (fails a reload socket that counts as a connection)",
    async () => {
      let connections = 0;
      CLAUDE_FIXTURE.use("plain");
      const running = await startWsHarness({
        provider: CLAUDE_FIXTURE.name,
        idleController: {
          increment: () => {
            connections += 1;
          },
          decrement: () => {
            connections -= 1;
          },
          touch: () => {},
        },
      });
      harness = running;
      const host = await startFakeReloadHost(running.port);
      await settled(host.socket);
      expect(connections).toBe(0);
      const chat = await openChat(running.port);
      sockets.push(chat);
      await settled(chat);
      expect(connections).toBe(1);
      host.socket.close();
      await vi.waitFor(() =>
        expect(running.bridge.services?.reloadHold.isHost(host.socket)).toBe(
          false,
        ),
      );
      chat.close();
      await vi.waitFor(() => expect(connections).toBe(0));
    },
    TEST_TIMEOUT_MS,
  );
});

describe("module reloads during a Build it turn", () => {
  it(
    "holds the reloads while the turn writes and reloads once when it is done (fails a turn that lets every builder write reload)",
    async () => {
      const running = await start();
      let reloadsBeforeEnd = -1;
      await runScript(running, async function* (ctx, watcher) {
        yield* builderWrites(ctx, watcher, WRITES);
        reloadsBeforeEnd = watcher.reloads;
        yield { type: "done" };
      });
      expect(reloadsBeforeEnd).toBe(0);
      expect(running.watcher.reloads).toBe(1);
      expect(running.watcher.held).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reloads once when the turn fails after its writes (fails a hold that only a finished turn releases)",
    async () => {
      const running = await start();
      await runScript(running, async function* (ctx, watcher) {
        yield* builderWrites(ctx, watcher, WRITES);
        throw new Error("the provider crashed");
      });
      expect(running.watcher.reloads).toBe(1);
      expect(running.watcher.held).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reloads once when the turn ends in an error event (fails a hold that only a done event releases)",
    async () => {
      const running = await start();
      await runScript(running, async function* (ctx, watcher) {
        yield* builderWrites(ctx, watcher, WRITES);
        yield { type: "error", message: "quota reached" };
      });
      expect(running.watcher.reloads).toBe(1);
      expect(running.watcher.held).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reloads once when the owner cancels the turn (fails a hold that an interrupt leaves in place)",
    async () => {
      const running = await start();
      const interrupted = defer();
      const toolRunning = defer();
      vi.spyOn(running.services.runner, "interruptSession").mockImplementation(
        () => interrupted.resolve(),
      );
      const chat = await openChat(running.harness.port);
      sockets.push(chat);
      sendHello(chat, CONVERSATION);
      await settled(chat);
      let reloadsBeforeCancel = -1;
      const turn = runScript(running, async function* (ctx, watcher) {
        yield* builderWrites(ctx, watcher, WRITES);
        reloadsBeforeCancel = watcher.reloads;
        yield {
          type: "tool_use",
          callId: "call-running",
          toolName: BUILDER_WRITE,
          args: {},
        };
        toolRunning.resolve();
        await interrupted.promise;
        yield { type: "done" };
      });
      await toolRunning.promise;
      interruptTurn(chat, CONVERSATION);
      await turn;
      expect(reloadsBeforeCancel).toBe(0);
      expect(running.watcher.reloads).toBe(1);
      expect(running.watcher.held).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("module reloads around a live read and a second turn", () => {
  it(
    "lets the writes so far reload before a tool reads the live app, then holds again (fails a hold that page_verify reads through)",
    async () => {
      const running = await start();
      let reloadsAtVerify = -1;
      await runScript(running, async function* (ctx, watcher) {
        yield* builderWrites(ctx, watcher, 2);
        yield {
          type: "tool_use",
          callId: "call-verify",
          toolName: LIVE_READ,
          args: {},
        };
        await ctx.beforeLiveRead?.();
        reloadsAtVerify = watcher.reloads;
        yield {
          type: "tool_result",
          callId: "call-verify",
          result: "ok",
          isError: false,
        };
        yield* builderWrites(ctx, watcher, 2);
        yield { type: "done" };
      });
      expect(reloadsAtVerify).toBe(1);
      expect(running.watcher.reloads).toBe(2);
      expect(running.watcher.held).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps reloads held for a turn that is still writing when another conversation's turn ends (fails a hold that is one flag, not one per conversation)",
    async () => {
      const running = await start();
      const second = defer();
      const secondWrote = defer();
      const first = runScript(running, async function* (ctx, watcher) {
        yield* builderWrites(ctx, watcher, 1);
        secondWrote.resolve();
        await second.promise;
        yield* builderWrites(ctx, watcher, 1);
        yield { type: "done" };
      });
      await secondWrote.promise;
      await running.services.reloadHold.hold("conv-other");
      await running.services.reloadHold.release("conv-other");
      expect(running.watcher.held).toBe(true);
      second.resolve();
      await first;
      expect(running.watcher.reloads).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );
});
