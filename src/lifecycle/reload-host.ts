import { Logging } from "@antelopejs/interface-core/logging";
import {
  HoldReloads,
  ReleaseReloads,
} from "@antelopejs/interface-core/modules";
import type WebSocket from "ws";
import type { RawData } from "ws";
import { z } from "zod";
import {
  RELOAD_HOLD_APPLIED_TYPE,
  RELOAD_HOLD_EVENT_TYPE,
  RELOAD_HOLD_TIMEOUT_MS,
  RELOAD_HOST_ROLE,
  RELOAD_RELEASE_TIMEOUT_MS,
  SIDECAR_LOG_PREFIX,
} from "../constants/sidecar";
import { rawDataToText } from "./raw-data";
import { connectSidecarSocket } from "./sidecar-socket";

/** The dev watcher's hold on module reloads, as the core offers it. */
export interface ReloadCore {
  /** Reloads queue while any hold exists; resolves with the hold's id. */
  hold: () => Promise<string>;
  /** The last release reloads the queued modules once and resolves after they finished. */
  release: (holdId: string) => Promise<void>;
}

export interface ReloadHostOptions {
  core: ReloadCore;
  /** Opens the sidecar socket, paused; the real one revives the sidecar first. */
  connect?: () => Promise<WebSocket>;
  holdTimeoutMs?: number;
  releaseTimeoutMs?: number;
}

export interface ReloadHost {
  /** Opens the reload socket unless it is open; a sidecar that cannot be reached is not an error. */
  ensure: () => Promise<void>;
  /** Releases its hold and closes the socket. */
  close: () => Promise<void>;
}

const HoldEventSchema = z.object({
  type: z.literal(RELOAD_HOLD_EVENT_TYPE),
  held: z.boolean(),
  seq: z.number(),
});

const TIMED_OUT = Symbol("timed out");

/** The work's value, or `TIMED_OUT` when it did not settle in time; a rejection is logged and counts as timed out. */
async function bounded<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome === TIMED_OUT) {
      Logging.Warn(`${SIDECAR_LOG_PREFIX} ${label} did not answer in time`);
    }
    return outcome;
  } catch (err) {
    Logging.Warn(`${SIDECAR_LOG_PREFIX} ${label} failed:`, err);
    return TIMED_OUT;
  } finally {
    clearTimeout(timer);
  }
}

interface HostState {
  options: Required<ReloadHostOptions>;
  socket: WebSocket | null;
  opening: Promise<void> | null;
  holdId: string | null;
  /** The last hold went unanswered: later ones are not asked until a late answer comes. */
  isCoreSilent: boolean;
  /** Every apply and release runs after the one before it. */
  queue: Promise<void>;
}

async function takeHold(state: HostState): Promise<void> {
  if (state.isCoreSilent) return;
  const { core, holdTimeoutMs } = state.options;
  const pending = core.hold();
  const id = await bounded(pending, holdTimeoutMs, "reload hold");
  if (id !== TIMED_OUT) {
    state.holdId = id;
    return;
  }
  state.isCoreSilent = true;
  void pending
    .then((lateId) => {
      state.isCoreSilent = false;
      return core.release(lateId);
    })
    .catch(() => undefined);
}

async function dropHold(state: HostState): Promise<void> {
  const { holdId } = state;
  if (holdId === null) return;
  state.holdId = null;
  await bounded(
    state.options.core.release(holdId),
    state.options.releaseTimeoutMs,
    "reload release",
  );
}

async function apply(
  state: HostState,
  socket: WebSocket,
  event: z.infer<typeof HoldEventSchema>,
): Promise<void> {
  if (event.held && state.holdId === null) await takeHold(state);
  if (!event.held) await dropHold(state);
  if (state.socket !== socket) return;
  socket.send(
    JSON.stringify({ type: RELOAD_HOLD_APPLIED_TYPE, seq: event.seq }),
  );
}

function enqueue(state: HostState, work: () => Promise<void>): Promise<void> {
  state.queue = state.queue.then(work).catch((err: unknown) => {
    Logging.Warn(`${SIDECAR_LOG_PREFIX} reload host failed:`, err);
  });
  return state.queue;
}

function parseHoldEvent(text: string): z.infer<typeof HoldEventSchema> | null {
  try {
    const parsed = HoldEventSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function onMessage(state: HostState, socket: WebSocket, data: RawData): void {
  const event = parseHoldEvent(rawDataToText(data));
  if (event !== null) void enqueue(state, () => apply(state, socket, event));
}

function adopt(state: HostState, socket: WebSocket): void {
  state.socket = socket;
  socket.on("message", (data) => onMessage(state, socket, data));
  socket.on("error", () => undefined);
  socket.on("close", () => {
    if (state.socket === socket) state.socket = null;
    void enqueue(state, () => dropHold(state));
  });
  socket.resume();
  socket.send(JSON.stringify({ type: "hello", role: RELOAD_HOST_ROLE }));
}

async function open(state: HostState): Promise<void> {
  try {
    adopt(state, await state.options.connect());
  } catch {
    state.socket = null;
  } finally {
    state.opening = null;
  }
}

function ensure(state: HostState): Promise<void> {
  if (state.socket !== null) return Promise.resolve();
  state.opening ??= open(state);
  return state.opening;
}

async function close(state: HostState): Promise<void> {
  await state.opening;
  const { socket } = state;
  state.socket = null;
  socket?.close();
  void dropHold(state);
}

/**
 * The module's end of the sidecar's reload hold. A turn that writes asks the
 * sidecar to hold the dev watcher's reloads; the sidecar tells this host over a
 * socket of its own, and the host takes or releases the core's hold and answers
 * once the core call settled. A hold the host cannot release (the socket
 * closed, the module stopping) is released at once, so a dead sidecar never
 * leaves reloads held.
 */
export function createReloadHost(options: ReloadHostOptions): ReloadHost {
  const state: HostState = {
    options: {
      connect: connectSidecarSocket,
      holdTimeoutMs: RELOAD_HOLD_TIMEOUT_MS,
      releaseTimeoutMs: RELOAD_RELEASE_TIMEOUT_MS,
      ...options,
    },
    socket: null,
    opening: null,
    holdId: null,
    isCoreSilent: false,
    queue: Promise.resolve(),
  };
  return { ensure: () => ensure(state), close: () => close(state) };
}

const CORE: ReloadCore = { hold: HoldReloads, release: ReleaseReloads };

let current: ReloadHost | null = null;

/** Opens the module's reload host on the core's watcher on the first call; later calls reuse it. */
export function ensureReloadHost(): Promise<void> {
  current ??= createReloadHost({ core: CORE });
  return current.ensure();
}

/** For `destroy()`: releases the hold and closes the reload socket. */
export async function closeReloadHost(): Promise<void> {
  const host = current;
  current = null;
  await host?.close();
}
