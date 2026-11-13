const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const {
  noAnswerReason,
  redact,
  serverRefusal,
  signedIn,
} = require("../../dist/builder/implementations/dms-builder/engine/database-access.js");
const { loadModule } = require("./helpers/load-module.cjs");

const CHECK_FILE = path.resolve(
  __dirname,
  "../../dist/builder/implementations/dms-builder/engine/database-check.js",
);

const SAMPLE_SECRET = `${require("node:crypto").randomBytes(4).toString("hex")}@/x`;
const ENCODED = encodeURIComponent(SAMPLE_SECRET);
const URL = `postgres://${["app", ENCODED].join(":")}@db.example.com:5432/shop`;

/**
 * @typedef {{ add: (close: () => unknown) => void }} Connections
 * @typedef {(url: string, timeoutMs: number, connections: Connections) => Promise<unknown>} Probe
 * @typedef {{ reachable: boolean, reason?: string }} Answer
 * @typedef {(engine: string, url: string, timeoutMs: number) => Promise<Answer>} Check
 */

/**
 * @param {unknown} exported
 * @returns {exported is { checkDatabase: Check }}
 */
function exposesCheck(exported) {
  return (
    typeof exported === "object" &&
    exported !== null &&
    "checkDatabase" in exported &&
    typeof exported.checkDatabase === "function"
  );
}

/**
 * The check with its three probes answered by the given ones.
 *
 * @param {{ postgres: Probe, mongodb: Probe, rethinkdb: Probe }} probes
 * @returns {Check}
 */
function loadCheck(probes) {
  return loadModule(
    CHECK_FILE,
    {
      "./probe-postgres": { probePostgres: probes.postgres },
      "./probe-mongodb": { probeMongodb: probes.mongodb },
      "./probe-rethinkdb": { probeRethinkdb: probes.rethinkdb },
    },
    exposesCheck,
  ).checkDatabase;
}

/** Fails on an implementation that leaves the URL or the password in a message, in any of their spellings. */
void test("redact removes the URL, the password as written, decoded and encoded, and any other connection string", () => {
  const message = `failed ${URL} for ${SAMPLE_SECRET} and ${ENCODED} and mongodb://other:${["secret", "2"].join("")}@h/x`;
  const redacted = redact(message, URL);
  for (const secret of [URL, SAMPLE_SECRET, ENCODED, "secret2", "mongodb://"]) {
    assert.equal(redacted.includes(secret), false, secret);
  }
});

/** Fails on an implementation that redacts every message into noise. */
void test("redact leaves a message that holds no secret as it is", () => {
  assert.equal(
    redact("Server selection timed out after 700 ms", URL),
    "Server selection timed out after 700 ms",
  );
});

/** Fails on an implementation that answers the driver's raw message for a refused port or a timeout. */
void test("a refused port and a timeout each get a sentence of their own", () => {
  assert.equal(
    noAnswerReason("connect ECONNREFUSED 127.0.0.1:1", URL),
    "Nothing is listening at this host and port.",
  );
  assert.equal(
    noAnswerReason("Server selection timed out after 700 ms", URL),
    "The database did not answer in time.",
  );
});

/** Fails on an implementation that answers a driver's message as it is. */
void test("a message no sentence covers is answered without the URL or the password", () => {
  const reason = noAnswerReason(`cannot parse ${URL} (${SAMPLE_SECRET})`, URL);
  assert.equal(reason.includes(SAMPLE_SECRET), false);
  assert.equal(reason.includes("db.example.com"), false);
  assert.match(reason, /^Could not check the database: /);
});

/** Fails on an implementation that sends `user: undefined`, or a reason with a readable database. */
void test("an account answers with its user and a reason only when it cannot read", () => {
  assert.deepEqual(signedIn(2, undefined, { canRead: true, canWrite: false }), {
    reachable: true,
    latencyMs: 2,
    canRead: true,
    canWrite: false,
  });
  assert.deepEqual(signedIn(2, "app", { canRead: false, canWrite: false }), {
    reachable: true,
    latencyMs: 2,
    user: "app",
    canRead: false,
    canWrite: false,
    reason: "This account cannot read this database.",
  });
});

/** Fails on an implementation that sends an engine's URL to another engine's probe. */
void test("each engine is checked by its own probe, with the URL and the timeout", async () => {
  /** @type {string[]} */
  const asked = [];
  /**
   * @param {string} engine
   * @returns {Probe}
   */
  const probe = (engine) => async (url, timeoutMs) => {
    asked.push(`${engine} ${url} ${timeoutMs}`);
    return { engine };
  };
  const checkDatabase = loadCheck({
    postgres: probe("postgres"),
    mongodb: probe("mongodb"),
    rethinkdb: probe("rethinkdb"),
  });
  const answers = [];
  for (const engine of ["postgres", "mongodb", "rethinkdb"]) {
    answers.push(await checkDatabase(engine, `${engine}://h/db`, 50));
  }
  assert.deepEqual(answers, [
    { engine: "postgres" },
    { engine: "mongodb" },
    { engine: "rethinkdb" },
  ]);
  assert.deepEqual(asked, [
    "postgres postgres://h/db 50",
    "mongodb mongodb://h/db 50",
    "rethinkdb rethinkdb://h/db 50",
  ]);
});

/** Fails on an implementation with no deadline, which waits for a probe that never answers. */
void test(
  "a probe that never answers ends the check as unreachable within three timeouts",
  { timeout: 3000 },
  async () => {
    /** @type {Probe} */
    const hung = () => new Promise(() => undefined);
    const checkDatabase = loadCheck({
      postgres: hung,
      mongodb: hung,
      rethinkdb: hung,
    });
    const started = performance.now();
    const answer = await checkDatabase("postgres", URL, 40);
    assert.deepEqual(answer, {
      reachable: false,
      canRead: false,
      canWrite: false,
      reason: "The database did not answer in time.",
    });
    assert.ok(performance.now() - started < 1000);
  },
);

/** Fails on an implementation that leaves a connection open when the deadline passes, or answers before it has started closing it. */
void test("the deadline closes what the probe opened, before it answers", async () => {
  /** @type {string[]} */
  const events = [];
  /** @type {Probe} */
  const stalled = (_url, _timeoutMs, connections) => {
    connections.add(async () => {
      events.push("closed");
    });
    return new Promise(() => undefined);
  };
  const checkDatabase = loadCheck({
    postgres: stalled,
    mongodb: stalled,
    rethinkdb: stalled,
  });
  const answer = await checkDatabase("rethinkdb", URL, 40);
  events.push("answered");
  assert.equal(answer.reason, "The database did not answer in time.");
  assert.deepEqual(events, ["closed", "answered"]);
});

/** Fails on an implementation that closes a connection only at the deadline, or answers before the close has finished. */
void test("an answer closes what the probe opened, once, and waits for it", async () => {
  /** @type {string[]} */
  const events = [];
  /** @type {Probe} */
  const answering = async (_url, _timeoutMs, connections) => {
    connections.add(async () => {
      events.push("closing");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("closed");
    });
    return { reachable: true };
  };
  const checkDatabase = loadCheck({
    postgres: answering,
    mongodb: answering,
    rethinkdb: answering,
  });
  const answer = await checkDatabase("mongodb", URL, 100);
  events.push("answered");
  assert.deepEqual(answer, { reachable: true });
  assert.deepEqual(events, ["closing", "closed", "answered"]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(events, ["closing", "closed", "answered"]);
});

/** Fails on an implementation that closes only what was open when the deadline passed, so a late connection stays open. */
void test("a connection opened after the deadline is closed at once", async () => {
  /** @type {string[]} */
  const closed = [];
  /** @type {Probe} */
  const late = async (_url, _timeoutMs, connections) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    connections.add(async () => {
      closed.push("late");
    });
    return { reachable: true };
  };
  const checkDatabase = loadCheck({
    postgres: late,
    mongodb: late,
    rethinkdb: late,
  });
  const answer = await checkDatabase("postgres", URL, 40);
  assert.equal(answer.reason, "The database did not answer in time.");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(closed, ["late"]);
});

/** Fails on an implementation that lets a connection that fails to close, or throws when asked, take the answer with it. */
void test("a connection that cannot be closed does not change the answer", async () => {
  /** @type {Probe} */
  const stubborn = async (_url, _timeoutMs, connections) => {
    connections.add(async () => {
      throw new Error("close failed");
    });
    connections.add(() => {
      throw new Error("close threw");
    });
    return { reachable: true };
  };
  const checkDatabase = loadCheck({
    postgres: stubborn,
    mongodb: stubborn,
    rethinkdb: stubborn,
  });
  assert.deepEqual(await checkDatabase("postgres", URL, 40), {
    reachable: true,
  });
});

/** Fails on an implementation that lets a probe's error out, or that answers its message with the password in it. */
void test("a probe that throws is answered, without the password", async () => {
  /** @type {Probe} */
  const broken = async () => {
    throw new Error(`driver failed on ${URL}: ${SAMPLE_SECRET}`);
  };
  const checkDatabase = loadCheck({
    postgres: broken,
    mongodb: broken,
    rethinkdb: broken,
  });
  const answer = await checkDatabase("postgres", URL, 40);
  assert.equal(answer.reachable, false);
  assert.equal(JSON.stringify(answer).includes(SAMPLE_SECRET), false);
  assert.equal(JSON.stringify(answer).includes("db.example.com"), false);
});

/** Fails on an implementation that answers a driver's message with the query it echoes: ReQL's backtrace, MongoDB's command. */
void test("a reason holds no query a driver echoes in its message", () => {
  const reql =
    'Database name `a.b` invalid (Use A-Z, a-z, 0-9, _ and - only) in:\nr.db("a.b").tableList()\n     ^^\n';
  assert.equal(
    noAnswerReason(reql, URL),
    "Could not check the database: Database name `a.b` invalid (Use A-Z, a-z, 0-9, _ and - only)",
  );
  const command =
    'not authorized on shop to execute command { find: "orders", filter: { card: "4111" }, $db: "shop" }';
  assert.equal(
    serverRefusal(command, URL),
    "The server refused the request: not authorized on shop to execute command",
  );
});

/** Fails on an implementation that matches a known sentence against the query a driver echoes, not against its message. */
void test("a word of the echoed query does not pick the sentence of a refused port or a timeout", () => {
  const message =
    'Database `refused` does not exist in:\nr.db("ECONNREFUSED").tableList()\n';
  assert.match(
    noAnswerReason(message, URL),
    /^Could not check the database: Database `refused` does not exist$/,
  );
});

/** Fails on an implementation that requires the three clients when it loads, or the other engines' when it checks one. */
void test("a client is required only when its engine is checked", () => {
  const script = `
    const Module = require("node:module");
    const clients = ["pg", "mongodb", "rethinkdb-ts"];
    const asked = [];
    const original = Module.prototype.require;
    Module.prototype.require = function (request) {
      if (clients.includes(request)) asked.push(request);
      return original.apply(this, arguments);
    };
    const { checkDatabase } = require(process.argv[1]);
    const afterLoad = [...asked];
    checkDatabase("postgres", "postgres://u@127.0.0.1:1/db", 500).then((answer) => {
      process.stdout.write(JSON.stringify({ afterLoad, asked, reachable: answer.reachable }));
    });
  `;
  const output = execFileSync(process.execPath, ["-e", script, CHECK_FILE], {
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(output), {
    afterLoad: [],
    asked: ["pg"],
    reachable: false,
  });
});
