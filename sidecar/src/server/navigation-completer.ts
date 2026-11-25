import { BLOCKS_REPORT_GRACE_MS } from "../constants/timing.js";
import type { PageBlockType } from "../protocol/messages.js";

/** What the host announced when the page landed. */
export interface NavigationAnnouncement {
  /** A block report for this path follows within this long. */
  blocksWithinMs?: number;
}

/** The landed page: the block report its host announced, when it did. */
export interface NavigationLanding {
  /** Resolves with the report, or null when it did not arrive in time. */
  blocks?: Promise<PageBlocksReport | null>;
}

/** What the host's data blocks showed once the page stopped changing. */
export interface PageBlocksReport {
  status: "settled" | "timeout" | "superseded";
  /** How many data blocks the page holds. */
  checked: number;
  /** The blocks that are empty, failed or still loading. */
  blocks: PageBlockType[];
}

/** Waits for a host to land on `path`; resolves null at the deadline. */
export type LandingWait = (
  path: string,
  timeoutMs: number,
) => Promise<NavigationLanding | null>;

/**
 * Pairs the agent's wait for a page with what a host reports about it. Every
 * call names the person (`viewerId`, the `userId` of the host's actor, null
 * without one) whose host lands or reports: a wait resolves only from that
 * person's hosts, never from another person's host on the same path.
 */
export interface NavigationCompleter {
  waitFor: (
    viewerId: string | null,
    path: string,
    timeoutMs: number,
  ) => Promise<NavigationLanding | null>;
  complete: (
    viewerId: string | null,
    path: string,
    announcement?: NavigationAnnouncement,
  ) => void;
  completeBlocks: (
    viewerId: string | null,
    path: string,
    report: PageBlocksReport,
  ) => void;
}

interface PendingEntry<T> {
  resolve: (value: T | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Waiters per key, each resolved once with a value or, at its deadline, `null`. */
interface Rendezvous<T> {
  wait: (key: string, timeoutMs: number) => Promise<T | null>;
  /** Resolves the oldest waiter of `key` with `make()`, called only if there is one. */
  deliver: (key: string, make: () => T) => void;
}

function createRendezvous<T>(): Rendezvous<T> {
  const pending = new Map<string, PendingEntry<T>[]>();

  const popEntry = (key: string): PendingEntry<T> | undefined => {
    const entries = pending.get(key);
    const entry = entries?.shift();
    if (entries?.length === 0) pending.delete(key);
    return entry;
  };

  return {
    wait: (key, timeoutMs) =>
      new Promise<T | null>((resolve) => {
        const entry: PendingEntry<T> = {
          resolve,
          timer: setTimeout(() => {
            const entries = pending.get(key);
            const index = entries?.indexOf(entry) ?? -1;
            if (entries === undefined || index < 0) return;
            entries.splice(index, 1);
            if (entries.length === 0) pending.delete(key);
            resolve(null);
          }, timeoutMs),
        };
        pending.set(key, [...(pending.get(key) ?? []), entry]);
      }),
    deliver: (key, make) => {
      const entry = popEntry(key);
      if (entry === undefined) return;
      clearTimeout(entry.timer);
      entry.resolve(make());
    },
  };
}

const NORMALIZE_BASE = "http://navigation.invalid";

/**
 * The form a navigation target and a landed page are compared in: the pathname
 * without a trailing slash, then the query string. The hash is dropped because
 * the host never reports it.
 */
export function normalizeNavigationPath(path: string): string {
  const url = new URL(path, NORMALIZE_BASE);
  const pathname =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return `${pathname === "" ? "/" : pathname}${url.search}`;
}

/** One person's host on one page, as the waiters are keyed. */
function waiterKey(viewerId: string | null, path: string): string {
  return JSON.stringify([viewerId, normalizeNavigationPath(path)]);
}

export function createNavigationCompleter(): NavigationCompleter {
  const landings = createRendezvous<NavigationLanding>();
  const reports = createRendezvous<PageBlocksReport>();
  return {
    waitFor: (viewerId, path, timeoutMs) =>
      landings.wait(waiterKey(viewerId, path), timeoutMs),
    complete: (viewerId, path, { blocksWithinMs } = {}) => {
      const key = waiterKey(viewerId, path);
      landings.deliver(key, () =>
        blocksWithinMs === undefined
          ? {}
          : {
              blocks: reports.wait(
                key,
                blocksWithinMs + BLOCKS_REPORT_GRACE_MS,
              ),
            },
      );
    },
    completeBlocks: (viewerId, path, report) =>
      reports.deliver(waiterKey(viewerId, path), () => report),
  };
}
