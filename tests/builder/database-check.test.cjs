const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const {
  noAnswerReason,
  redact,
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
 * @typedef {(url: string, timeoutMs: number) => Promise<unknown>} Probe
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
