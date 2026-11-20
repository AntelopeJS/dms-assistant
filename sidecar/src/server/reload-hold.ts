import { RELOAD_HOLD_ACK_TIMEOUT_MS, WS_LOG_PREFIX } from "../constants/ws.js";
import { RELOAD_HOLD_EVENT } from "../protocol/reload-hold.js";
import type { SocketSender } from "./host-socket-registry.js";

export interface ReloadHoldOptions {
  ackTimeoutMs?: number;
}

/**
 * Whether the dev watcher's module reloads are held. The conversations that
 * write hold them; the module's reload host applies the state to the core and
 * answers. No call here rejects: a turn never fails because a hold could not
 * be applied.
 */
export interface ReloadHold {
  /** Holds reloads for the conversation; resolves once the host applied it. */
  hold: (conversationId: string) => Promise<void>;
  /** Drops the conversation's hold; resolves once the reloads it kept ran. */
  release: (conversationId: string) => Promise<void>;
  /** Drops every conversation's hold, for a tool that reads the live app. */
  releaseAll: () => Promise<void>;
  /** The module's reload socket said hello: it gets the current state at once. */
  attach: (socket: SocketSender) => void;
  /** The reload socket closed: every answer still awaited is given up. */
  detach: (socket: SocketSender) => void;
  /** Whether the socket is the attached reload host. */
  isHost: (socket: SocketSender) => boolean;
  /** The host answered every event up to `seq`. */
  applied: (seq: number) => void;
}

interface HoldState {
  ackTimeoutMs: number;
  holders: Set<string>;
  host: SocketSender | null;
  seq: number;
  sentHeld: boolean;
  /** The answer awaited for each event sent, by `seq`. */
  acks: Map<number, () => void>;
  /** Settles with the latest event sent. */
  lastAck: Promise<void>;
}

function settleAcks(
  state: HoldState,
  isSettled: (seq: number) => boolean,
): void {
  for (const [seq, settle] of state.acks) {
    if (isSettled(seq)) settle();
  }
}

function waitForAck(state: HoldState, seq: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`${WS_LOG_PREFIX} reload host did not answer seq=${seq}`);
      state.acks.delete(seq);
      resolve();
    }, state.ackTimeoutMs);
    timer.unref();
    state.acks.set(seq, () => {
      clearTimeout(timer);
      state.acks.delete(seq);
      resolve();
    });
  });
}

function sendState(state: HoldState, host: SocketSender, held: boolean): void {
  state.seq += 1;
  const { seq } = state;
  state.sentHeld = held;
  const answered = waitForAck(state, seq);
  state.lastAck = answered;
  try {
    host.send(JSON.stringify({ type: RELOAD_HOLD_EVENT, held, seq }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} reload_hold send failed: ${message}`);
    state.acks.get(seq)?.();
  }
}

async function sync(state: HoldState): Promise<void> {
  const { host } = state;
  if (host === null) return;
  const held = state.holders.size > 0;
  if (held === state.sentHeld) {
    await state.lastAck;
    return;
  }
  sendState(state, host, held);
  await state.lastAck;
}

export function createReloadHold(options: ReloadHoldOptions = {}): ReloadHold {
  const state: HoldState = {
    ackTimeoutMs: options.ackTimeoutMs ?? RELOAD_HOLD_ACK_TIMEOUT_MS,
    holders: new Set(),
    host: null,
    seq: 0,
    sentHeld: false,
    acks: new Map(),
    lastAck: Promise.resolve(),
  };
  const dropHost = (): void => {
    state.host = null;
    state.sentHeld = false;
    settleAcks(state, () => true);
    state.lastAck = Promise.resolve();
  };
  return {
    hold: (conversationId) => {
      state.holders.add(conversationId);
      return sync(state);
    },
    release: (conversationId) => {
      state.holders.delete(conversationId);
      return sync(state);
    },
    releaseAll: () => {
      state.holders.clear();
      return sync(state);
    },
    attach: (socket) => {
      dropHost();
      state.host = socket;
      sendState(state, socket, state.holders.size > 0);
    },
    detach: (socket) => {
      if (state.host === socket) dropHost();
    },
    isHost: (socket) => state.host === socket,
    applied: (seq) => settleAcks(state, (pending) => pending <= seq),
  };
}
