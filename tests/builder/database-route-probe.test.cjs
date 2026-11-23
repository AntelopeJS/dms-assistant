const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const {
  HTTPResult,
  loadDatabaseController,
} = require("./helpers/database-controller.cjs");

const OWNER = { _id: "owner" };
const PROJECT = {
  modules: ["dms"],
  self: "dms",
  databasePins: [],
  drivers: {},
};
const CORE_BUILDER_DISABLED =
  "The DMS builder is not enabled in this environment. Set builder.enabled to true in the dms module's config, or leave it unset and run the project with ajs project dev.";

const UnavailableSchema = z.object({
  code: z.literal("unavailable"),
  message: z.string(),
});

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** @param {unknown} answered */
function assertBuilderOff(answered) {
  assert.ok(answered instanceof HTTPResult);
  assert.equal(answered.status, 503);
  assert.match(
    UnavailableSchema.parse(answered.body).message,
    /builder\.enabled/,
  );
}

void test(
  "once interface-core's queue of calls without a provider is full, every request still answers 503 within 10 s",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { AsyncProxy } = require("@antelopejs/interface-core/proxies");
    const { internal } = require("@antelopejs/interface-core/internal");
    const limit = internal.maxPendingOperations;
    internal.maxPendingOperations = 2;
    t.after(() => {
      internal.maxPendingOperations = limit;
    });
    const project = new AsyncProxy("GetDatabaseProject");
    const list = new AsyncProxy("ListDatabaseConnections");
    const route = loadDatabaseController({
      GetDatabaseProject: () => project.call(),
      ListDatabaseConnections: () => list.call(),
    }).route("GET", "/database/connections");
    for (const request of [1, 2, 3, 4]) {
      let settled = false;
      const answer = route.call(OWNER).finally(() => {
        settled = true;
      });
      await settle();
      t.mock.timers.tick(10_000);
      await settle();
      assert.equal(settled, true, `request ${request}`);
      assertBuilderOff(await answer);
    }
  },
);

void test(
  "after an operation was rejected as off, the next request asks for the project again and answers 503 at the deadline when nothing serves it",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const unanswered = () => new Promise(() => {});
    let projectReads = 0;
    /** @type {() => Promise<unknown>} */
    let project = async () => ({ ok: true, data: PROJECT, changes: [] });
    /** @type {() => Promise<unknown>} */
    let list = () => Promise.reject(new Error(CORE_BUILDER_DISABLED));
    const route = loadDatabaseController({
      GetDatabaseProject: () => {
        projectReads += 1;
        return project();
      },
      ListDatabaseConnections: () => list(),
    }).route("GET", "/database/connections");
    assertBuilderOff(await route.call(OWNER));
    project = unanswered;
    list = unanswered;
    let settled = false;
    const next = route.call(OWNER).finally(() => {
      settled = true;
    });
    await settle();
    t.mock.timers.tick(10_000);
    await settle();
    assert.equal(projectReads, 2);
    assert.equal(settled, true);
    assertBuilderOff(await next);
  },
);
