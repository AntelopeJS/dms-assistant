import type { WebSocket } from "ws";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import type { AnyServerEventType } from "../protocol/events.js";

/** The part of a socket the registries use: they only ever send to it. */
export type SocketSender = Pick<WebSocket, "send">;

/** The event one socket of a broadcast receives. */
export type EventForSocket = (socket: SocketSender) => AnyServerEventType;

export interface HostSocketRegistry {
  set: (socket: SocketSender) => void;
  clear: (socket: SocketSender) => void;
  /**
   * Sends a command to one host the conversation's owner `owns`: the
   * preferred socket when it is one, else that person's latest host. Another
   * person's host never receives it.
   */
  send: (
    event: AnyServerEventType,
    owns: (socket: SocketSender) => boolean,
    preferred?: SocketSender,
  ) => void;
  /** Every host, each once, except the sockets `isServed` already answers for. */
  broadcast: (
    event: AnyServerEventType,
    isServed?: (socket: SocketSender) => boolean,
  ) => void;
  /** `broadcast` with an event built for each socket. */
  broadcastEach: (
    eventFor: EventForSocket,
    isServed?: (socket: SocketSender) => boolean,
  ) => void;
  has: () => boolean;
}

interface RegistryState {
  sockets: SocketSender[];
}

function trySend(socket: SocketSender, event: AnyServerEventType): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} sendToHost failed: ${message}`);
  }
}

function removeSocket(state: RegistryState, socket: SocketSender): void {
  state.sockets = state.sockets.filter((current) => current !== socket);
}

function buildSet(state: RegistryState) {
  return (socket: SocketSender): void => {
    removeSocket(state, socket);
    state.sockets.push(socket);
  };
}

function pickSocket(
  state: RegistryState,
  owns: (socket: SocketSender) => boolean,
  preferred: SocketSender | undefined,
): SocketSender | undefined {
  const owned = state.sockets.filter(owns);
  if (preferred !== undefined && owned.includes(preferred)) return preferred;
  return owned.at(-1);
}

function buildSend(state: RegistryState) {
  return (
    event: AnyServerEventType,
    owns: (socket: SocketSender) => boolean,
    preferred?: SocketSender,
  ): void => {
    const socket = pickSocket(state, owns, preferred);
    if (socket === undefined) {
      console.warn(`${WS_LOG_PREFIX} sendToHost: no host connected`);
      return;
    }
    trySend(socket, event);
  };
}

function buildBroadcastEach(state: RegistryState) {
  return (
    eventFor: EventForSocket,
    isServed: (socket: SocketSender) => boolean = () => false,
  ): void => {
    for (const socket of state.sockets) {
      if (!isServed(socket)) trySend(socket, eventFor(socket));
    }
  };
}

/**
 * Tracks every socket that said hello as a host. A command goes to the
 * preferred socket when it is still a host its owner owns, else to that
 * owner's latest host.
 */
export function createHostSocketRegistry(): HostSocketRegistry {
  const state: RegistryState = { sockets: [] };
  const broadcastEach = buildBroadcastEach(state);
  return {
    set: buildSet(state),
    clear: (socket) => removeSocket(state, socket),
    send: buildSend(state),
    broadcast: (event, isServed) => broadcastEach(() => event, isServed),
    broadcastEach,
    has: () => state.sockets.length > 0,
  };
}
