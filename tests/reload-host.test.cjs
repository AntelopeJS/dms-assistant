const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const {
  closeEverything,
  delay,
  startSidecar,
  waitFor,
} = require("./helpers/channels.cjs");

const { createReloadHost } = require("../dist/lifecycle/reload-host.js");

const SHORT_TIMEOUT_MS = 50;
const HELLO = '{"type":"hello","role":"reload"}';

/** @type {Array<{ close: () => Promise<void> }>} */
const hosts = [];

/** @type {Array<{ finishRelease: Array<() => void> }>} */
const cores = [];
const FINISH_POLL_MS = 10;

afterEach(async () => {
  const closing = hosts.splice(0).map((host) => host.close());
  const finishing = setInterval(() => {
    for (const core of cores) {
      for (const finish of core.finishRelease.splice(0)) finish();
    }
  }, FINISH_POLL_MS);
  await Promise.all(closing);
  clearInterval(finishing);
  cores.length = 0;
  await closeEverything();
});

/**
 * A core that records its calls. A release answers at once, or when the test finishes it with `manualRelease`.
 * @param {{ manualRelease?: boolean }} [options]
 */
function fakeCore(options = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {Array<() => void>} */
  const finishRelease = [];
  const core = {
    calls,
    finishRelease,
    hold: () => {
      calls.push("hold");
      return Promise.resolve("hold-1");
    },
    release: (/** @type {string} */ id) => {
      calls.push(`release:${id}`);
      if (options.manualRelease !== true) return Promise.resolve();
      return new Promise((resolve) => finishRelease.push(resolve));
    },
  };
  cores.push(core);
  return core;
}

/**
 * @param {ReturnType<typeof fakeCore>} core
 * @param {Awaited<ReturnType<typeof startSidecar>>} sidecar
 * @param {object} [options]
 */
async function startHost(core, sidecar, options = {}) {
  const host = createReloadHost({ core, connect: sidecar.connect, ...options });
  hosts.push(host);
  await host.ensure();
  await waitFor(() => sidecar.sockets.length === 1, "the reload socket");
  return host;
}

/** @param {import("ws").WebSocket} socket @param {boolean} held @param {number} seq */
function sendHold(socket, held, seq) {
  socket.send(JSON.stringify({ type: "reload_hold", held, seq }));
}

const applied = (/** @type {number} */ seq) =>
  JSON.stringify({ type: "reload_hold_applied", seq });

void test("says hello as the reload host once, however often it is ensured (fails a host that opens a socket per ensure)", async () => {
  const sidecar = await startSidecar();
  const host = await startHost(fakeCore(), sidecar);
  await host.ensure();
  await host.ensure();
  await waitFor(() => sidecar.received.length === 1, "hello");
  assert.deepEqual(sidecar.received, [HELLO]);
  assert.equal(sidecar.sockets.length, 1);
});

void test("swallows a sidecar it cannot reach, and tries again on the next ensure (fails a host that throws or stays closed)", async () => {
  const sidecar = await startSidecar();
  let attempts = 0;
  const host = createReloadHost({
    core: fakeCore(),
    connect: () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("down"))
        : sidecar.connect();
    },
  });
  hosts.push(host);
  await host.ensure();
  assert.equal(sidecar.sockets.length, 0);
  await host.ensure();
  await waitFor(() => sidecar.sockets.length === 1, "the retried socket");
});

void test("answers a hold once the core took it, and a release once the core finished it (fails a host that answers when the event arrives)", async () => {
  const core = fakeCore({ manualRelease: true });
  const sidecar = await startSidecar();
  await startHost(core, sidecar);
  const [server] = sidecar.sockets;
  sendHold(server, true, 1);
  await waitFor(() => sidecar.received.includes(applied(1)), "the hold answer");
  sendHold(server, false, 2);
  await waitFor(() => core.finishRelease.length === 1, "the core release");
  await delay(SHORT_TIMEOUT_MS);
  assert.ok(!sidecar.received.includes(applied(2)));
  core.finishRelease[0]();
  await waitFor(
    () => sidecar.received.includes(applied(2)),
    "the release answer",
  );
  assert.deepEqual(core.calls, ["hold", "release:hold-1"]);
});

void test("applies events in the order they came, a release right behind its hold included (fails a host that races its core calls)", async () => {
  const core = fakeCore({ manualRelease: true });
  const sidecar = await startSidecar();
  await startHost(core, sidecar);
  const [server] = sidecar.sockets;
  sendHold(server, true, 1);
  sendHold(server, false, 2);
  sendHold(server, true, 3);
  await waitFor(() => core.finishRelease.length === 1, "the core release");
  core.finishRelease[0]();
  await waitFor(() => sidecar.received.includes(applied(3)), "the last answer");
  assert.deepEqual(core.calls, ["hold", "release:hold-1", "hold"]);
  assert.deepEqual(sidecar.received.slice(1), [
    applied(1),
    applied(2),
    applied(3),
  ]);
});

void test("takes no second hold while one is held, and no release without one (fails a host that holds per event)", async () => {
  const core = fakeCore();
  const sidecar = await startSidecar();
  await startHost(core, sidecar);
  const [server] = sidecar.sockets;
  sendHold(server, false, 1);
  sendHold(server, true, 2);
  sendHold(server, true, 3);
  await waitFor(() => sidecar.received.includes(applied(3)), "the answers");
  assert.deepEqual(core.calls, ["hold"]);
});

void test("releases its hold when the sidecar's socket closes (fails a host that leaves reloads held after the sidecar dies)", async () => {
  const core = fakeCore();
  const sidecar = await startSidecar();
  await startHost(core, sidecar);
  const [server] = sidecar.sockets;
  sendHold(server, true, 1);
  await waitFor(() => sidecar.received.includes(applied(1)), "the hold answer");
  server.terminate();
  await waitFor(() => core.calls.includes("release:hold-1"), "the release");
  assert.deepEqual(core.calls, ["hold", "release:hold-1"]);
});

void test("still answers when the core never takes the hold, and gives a late hold back (fails a host that wedges the turn on a core without the API)", async () => {
  /** @type {(id: string) => void} */
  let answerLate = () => undefined;
  const core = fakeCore();
  core.hold = () => {
    core.calls.push("hold");
    return new Promise((resolve) => {
      answerLate = resolve;
    });
  };
  const sidecar = await startSidecar();
  await startHost(core, sidecar, { holdTimeoutMs: SHORT_TIMEOUT_MS });
  sendHold(sidecar.sockets[0], true, 1);
  await waitFor(() => sidecar.received.includes(applied(1)), "the answer");
  answerLate("late-1");
  await waitFor(() => core.calls.includes("release:late-1"), "the give-back");
  assert.deepEqual(core.calls, ["hold", "release:late-1"]);
});

void test("asks a core that never took a hold no more, so later turns do not wait for it (fails a host that waits the hold timeout on every turn)", async () => {
  const core = fakeCore();
  core.hold = () => {
    core.calls.push("hold");
    return new Promise(() => undefined);
  };
  const sidecar = await startSidecar();
  await startHost(core, sidecar, { holdTimeoutMs: SHORT_TIMEOUT_MS });
  sendHold(sidecar.sockets[0], true, 1);
  await waitFor(() => sidecar.received.includes(applied(1)), "the answer");
  sendHold(sidecar.sockets[0], false, 2);
  sendHold(sidecar.sockets[0], true, 3);
  await waitFor(() => sidecar.received.includes(applied(3)), "the answer");
  assert.deepEqual(core.calls, ["hold"]);
});

void test("still answers when the core never finishes the release (fails a host that waits on the core forever)", async () => {
  const core = fakeCore({ manualRelease: true });
  const sidecar = await startSidecar();
  await startHost(core, sidecar, { releaseTimeoutMs: SHORT_TIMEOUT_MS });
  const [server] = sidecar.sockets;
  sendHold(server, true, 1);
  sendHold(server, false, 2);
  await waitFor(() => sidecar.received.includes(applied(2)), "the answer");
  assert.deepEqual(core.calls, ["hold", "release:hold-1"]);
});

void test("releases its hold and closes the socket on close (fails a destroy that leaves reloads held)", async () => {
  const core = fakeCore({ manualRelease: true });
  const sidecar = await startSidecar();
  const host = await startHost(core, sidecar);
  const [server] = sidecar.sockets;
  sendHold(server, true, 1);
  await waitFor(() => sidecar.received.includes(applied(1)), "the hold answer");
  await host.close();
  assert.deepEqual(core.calls, ["hold", "release:hold-1"]);
  await waitFor(() => sidecar.closed === 1, "the socket closing");
});

void test(
  "closes at once while the release it is applying waits on the reloads that destroy it (fails a destroy that waits on its own release)",
  { timeout: 2_000 },
  async () => {
    const core = fakeCore({ manualRelease: true });
    const sidecar = await startSidecar();
    const host = await startHost(core, sidecar);
    const [server] = sidecar.sockets;
    sendHold(server, true, 1);
    await waitFor(
      () => sidecar.received.includes(applied(1)),
      "the hold answer",
    );
    sendHold(server, false, 2);
    await waitFor(() => core.finishRelease.length === 1, "the core release");
    await host.close();
    assert.deepEqual(core.calls, ["hold", "release:hold-1"]);
  },
);
