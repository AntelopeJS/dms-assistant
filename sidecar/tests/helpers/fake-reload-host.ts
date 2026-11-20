import type WebSocket from "ws";
import { ReloadHoldEvent } from "../../src/protocol/reload-hold.js";
import { rawDataToText } from "../../src/server/raw-data.js";
import { connectClient, sendWire, waitForOpen } from "./ws-harness.js";

/** The dev watcher's reload behaviour as the core defines it. */
export interface FakeWatcher {
  held: boolean;
  pending: boolean;
  reloads: number;
  /** A builder write lands: reloads at once, or waits while held. */
  write: () => void;
}

function createFakeWatcher(): FakeWatcher {
  const watcher: FakeWatcher = {
    held: false,
    pending: false,
    reloads: 0,
    write: () => {
      if (watcher.held) {
        watcher.pending = true;
        return;
      }
      watcher.reloads += 1;
    },
  };
  return watcher;
}

function applyHold(watcher: FakeWatcher, held: boolean): void {
  watcher.held = held;
  if (held || !watcher.pending) return;
  watcher.pending = false;
  watcher.reloads += 1;
}

export interface FakeReloadHost {
  socket: WebSocket;
  watcher: FakeWatcher;
}

/**
 * A real reload socket: says hello as the reload host and answers each
 * `reload_hold` once it has applied it to its fake watcher.
 */
export async function startFakeReloadHost(
  port: number,
): Promise<FakeReloadHost> {
  const socket = connectClient(port);
  await waitForOpen(socket);
  const watcher = createFakeWatcher();
  socket.on("message", (data) => {
    const frame = ReloadHoldEvent.safeParse(JSON.parse(rawDataToText(data)));
    if (!frame.success) return;
    applyHold(watcher, frame.data.held);
    sendWire(socket, { type: "reload_hold_applied", seq: frame.data.seq });
  });
  sendWire(socket, { type: "hello", role: "reload" });
  return { socket, watcher };
}
