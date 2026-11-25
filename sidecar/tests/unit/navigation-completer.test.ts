import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKS_REPORT_GRACE_MS } from "../../src/constants/timing.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

const TIMEOUT_MS = 3000;
const OWNER = "u-owner";
const OTHER = "u-other";

function useFakeTimersPerTest(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}

describe("createNavigationCompleter", () => {
  useFakeTimersPerTest();

  it("resolves with the landing when complete is called for the matching path", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    completer.complete(OWNER, "/foo");
    await expect(promise).resolves.toEqual({});
  });

  it("matches a target with a query string against the landed page's pathname and query", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/mockup?name=shop", TIMEOUT_MS);
    completer.complete(OWNER, "/mockup?name=shop");
    await expect(promise).resolves.toEqual({});
  });

  it("does not match a landed page whose query differs from the target", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/mockup?name=shop", TIMEOUT_MS);
    completer.complete(OWNER, "/mockup");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(promise).resolves.toBeNull();
  });

  it("ignores the hash and a trailing slash when matching", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(
      OWNER,
      "/mockup/?name=shop#top",
      TIMEOUT_MS,
    );
    completer.complete(OWNER, "/mockup?name=shop");
    await expect(promise).resolves.toEqual({});
  });

  it("routes the block report by the same normalized path", async () => {
    const completer = createNavigationCompleter();
    const landing = completer.waitFor(OWNER, "/mockup/?name=shop", TIMEOUT_MS);
    completer.complete(OWNER, "/mockup?name=shop", { blocksWithinMs: 1000 });
    const report = { status: "settled" as const, checked: 0, blocks: [] };
    completer.completeBlocks(OWNER, "/mockup?name=shop", report);
    await expect((await landing)?.blocks).resolves.toEqual(report);
  });

  it("resolves null when the timeout elapses with no completion", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(promise).resolves.toBeNull();
  });

  it("resolves concurrent waits for distinct paths independently", async () => {
    const completer = createNavigationCompleter();
    const promiseA = completer.waitFor(OWNER, "/a", TIMEOUT_MS);
    const promiseB = completer.waitFor(OWNER, "/b", TIMEOUT_MS);
    completer.complete(OWNER, "/b");
    await expect(promiseB).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(promiseA).resolves.toBeNull();
  });

  it("ignores complete calls for paths with no pending wait", () => {
    const completer = createNavigationCompleter();
    expect(() => completer.complete(OWNER, "/missing")).not.toThrow();
  });

  it("matches multiple sequential waits for the same path one-by-one", async () => {
    const completer = createNavigationCompleter();
    const first = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    const second = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    completer.complete(OWNER, "/foo");
    await expect(first).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(second).resolves.toBeNull();
  });
});

describe("createNavigationCompleter block reports", () => {
  useFakeTimersPerTest();

  it("hands the waiter the block report its host announced", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    completer.complete(OWNER, "/foo", { blocksWithinMs: 15_000 });
    const report = {
      status: "settled" as const,
      checked: 2,
      blocks: [{ type: "Chart", state: "empty" as const }],
    };
    completer.completeBlocks(OWNER, "/foo", report);
    const landing = await promise;
    await expect(landing?.blocks).resolves.toEqual(report);
  });

  it("keeps a report that arrives in the same tick as the landing", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    const report = { status: "settled" as const, checked: 0, blocks: [] };
    completer.complete(OWNER, "/foo", { blocksWithinMs: 15_000 });
    completer.completeBlocks(OWNER, "/foo", report);
    await expect((await promise)?.blocks).resolves.toEqual(report);
  });

  it("gives up on a report that never comes, after the time announced and some slack", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    completer.complete(OWNER, "/foo", { blocksWithinMs: 15_000 });
    const landing = await promise;
    await vi.advanceTimersByTimeAsync(15_000 + BLOCKS_REPORT_GRACE_MS + 1);
    await expect(landing?.blocks).resolves.toBeNull();
  });

  it("announces no report when the host did not", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    completer.complete(OWNER, "/foo");
    await expect(promise).resolves.toEqual({});
  });

  it("holds no report waiter for a navigation nobody waits on", async () => {
    const completer = createNavigationCompleter();
    completer.complete(OWNER, "/foo", { blocksWithinMs: 15_000 });
    completer.completeBlocks(OWNER, "/foo", {
      status: "settled",
      checked: 0,
      blocks: [],
    });
    const waiter = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    completer.complete(OWNER, "/foo", { blocksWithinMs: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000 + BLOCKS_REPORT_GRACE_MS + 1);
    await expect((await waiter)?.blocks).resolves.toBeNull();
  });
});

describe("createNavigationCompleter across people", () => {
  useFakeTimersPerTest();

  it("ignores another person's host landing on the path and reporting its blocks (fails a completer keyed by path alone)", async () => {
    const completer = createNavigationCompleter();
    const landing = completer.waitFor(OWNER, "/foo", TIMEOUT_MS);
    completer.complete(OTHER, "/foo");
    completer.complete(OWNER, "/foo", { blocksWithinMs: 1000 });
    const reported = (await landing)?.blocks;
    const report = { status: "settled" as const, checked: 0, blocks: [] };
    completer.completeBlocks(OTHER, "/foo", report);
    await vi.advanceTimersByTimeAsync(1000 + BLOCKS_REPORT_GRACE_MS + 1);
    await expect(reported).resolves.toBeNull();
  });
});
