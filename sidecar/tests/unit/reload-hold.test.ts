import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { ReloadHoldEvent } from "../../src/protocol/reload-hold.js";
import { createReloadHold } from "../../src/server/reload-hold.js";
import { flushCallbacks, watchSettle } from "../helpers/deferred.js";

type Frame = z.infer<typeof ReloadHoldEvent>;

function fakeHost() {
  const frames: Frame[] = [];
  return {
    frames,
    send: (raw: string) => {
      frames.push(ReloadHoldEvent.parse(JSON.parse(raw)));
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the reload hold", () => {
  it("settles at once with no reload host attached (fails a hold that waits for a host the module never opened)", async () => {
    const hold = createReloadHold();
    await expect(hold.hold("a")).resolves.toBeUndefined();
    await expect(hold.release("a")).resolves.toBeUndefined();
  });

  it("answers a release only once the host applied it (fails a release that returns when the event is sent)", async () => {
    const hold = createReloadHold();
    const host = fakeHost();
    hold.attach(host);
    hold.applied(1);
    const held = hold.hold("a");
    await flushCallbacks();
    hold.applied(2);
    await held;
    const release = watchSettle(hold.release("a"));
    await flushCallbacks();
    expect(host.frames.at(-1)).toMatchObject({ held: false, seq: 3 });
    expect(release.isSettled()).toBe(false);
    hold.applied(3);
    await flushCallbacks();
    expect(release.isSettled()).toBe(true);
  });

  it("sends one hold for many holders and one release for the last (fails a hold that sends an event per holder)", async () => {
    const hold = createReloadHold();
    const host = fakeHost();
    hold.attach(host);
    hold.applied(1);
    const holds = [hold.hold("a"), hold.hold("b")];
    hold.applied(2);
    await Promise.all(holds);
    const releaseFirst = hold.release("a");
    await releaseFirst;
    expect(host.frames.map((f) => f.held)).toEqual([false, true]);
    const releaseLast = hold.release("b");
    hold.applied(3);
    await releaseLast;
    expect(host.frames.map((f) => f.held)).toEqual([false, true, false]);
  });

  it("releases every conversation's hold at once (fails a releaseAll that drops the caller's own hold only)", async () => {
    const hold = createReloadHold();
    const host = fakeHost();
    hold.attach(host);
    hold.applied(1);
    const held = [hold.hold("a"), hold.hold("b")];
    hold.applied(2);
    await Promise.all(held);
    const all = hold.releaseAll();
    hold.applied(3);
    await all;
    expect(host.frames.at(-1)).toMatchObject({ held: false });
  });

  it("gives up on a host that never answers, without rejecting (fails a turn that hangs on a host without the core API)", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hold = createReloadHold({ ackTimeoutMs: 1_000 });
    hold.attach(fakeHost());
    const held = hold.hold("a");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(held).resolves.toBeUndefined();
  });

  it("gives up on every answer when the host's socket closes (fails a turn that waits on a closed reload socket)", async () => {
    const hold = createReloadHold();
    const host = fakeHost();
    hold.attach(host);
    const held = watchSettle(hold.hold("a"));
    await flushCallbacks();
    expect(held.isSettled()).toBe(false);
    hold.detach(host);
    await flushCallbacks();
    expect(held.isSettled()).toBe(true);
  });

  it("tells a host that attaches while a turn writes to hold (fails a module that reconnects mid-build and reloads on every write)", async () => {
    const hold = createReloadHold();
    void hold.hold("a");
    const host = fakeHost();
    hold.attach(host);
    expect(host.frames).toMatchObject([{ held: true }]);
  });
});
