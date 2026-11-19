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

export interface NavigationCompleter {
  waitFor: (
    path: string,
    timeoutMs: number,
  ) => Promise<NavigationLanding | null>;
  complete: (path: string, announcement?: NavigationAnnouncement) => void;
  completeBlocks: (path: string, report: PageBlocksReport) => void;
}

interface PendingEntry<T> {
  resolve: (value: T | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Waiters per path, each resolved once with a value or, at its deadline, `null`. */
interface Rendezvous<T> {
  wait: (path: string, timeoutMs: number) => Promise<T | null>;
  /** Resolves the oldest waiter of `path` with `make()`, called only if there is one. */
  deliver: (path: string, make: () => T) => void;
}

function createRendezvous<T>(): Rendezvous<T> {
  const pending = new Map<string, PendingEntry<T>[]>();

  const popEntry = (path: string): PendingEntry<T> | undefined => {
    const entries = pending.get(path);
    const entry = entries?.shift();
    if (entries?.length === 0) pending.delete(path);
    return entry;
  };

  return {
    wait: (path, timeoutMs) =>
      new Promise<T | null>((resolve) => {
        const entry: PendingEntry<T> = {
          resolve,
          timer: setTimeout(() => {
            const entries = pending.get(path);
            const index = entries?.indexOf(entry) ?? -1;
            if (entries === undefined || index < 0) return;
            entries.splice(index, 1);
            if (entries.length === 0) pending.delete(path);
            resolve(null);
          }, timeoutMs),
        };
        pending.set(path, [...(pending.get(path) ?? []), entry]);
      }),
    deliver: (path, make) => {
      const entry = popEntry(path);
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

export function createNavigationCompleter(): NavigationCompleter {
  const landings = createRendezvous<NavigationLanding>();
  const reports = createRendezvous<PageBlocksReport>();
  return {
    waitFor: (path, timeoutMs) =>
      landings.wait(normalizeNavigationPath(path), timeoutMs),
    complete: (path, { blocksWithinMs } = {}) => {
      const key = normalizeNavigationPath(path);
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
    completeBlocks: (path, report) =>
      reports.deliver(normalizeNavigationPath(path), () => report),
  };
}
