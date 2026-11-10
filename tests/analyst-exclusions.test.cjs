const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { installRequireMocks } = require("./helpers/require-mocks.cjs");

const IDENTITY = { userId: "u", tenantId: "t" };
const HTTP_SERVICE_UNAVAILABLE = 503;

let dmsCalls = 0;
/** @type {() => void} */
let restore;
/** @type {typeof import("../dist/analyst/catalog.js")} */
let catalog;
/** @type {typeof import("../dist/analyst/refusal.js")} */
let refusal;

before(() => {
  restore = installRequireMocks(
    new Map([
      ["@antelopejs/interface-core/logging", { Logging: { Error() {} } }],
      [
        "../db/analyst-exclusion",
        {
          analystExclusions: () => ({
            getAll: () => Promise.reject(new Error("database is down")),
          }),
        },
      ],
      [
        "./as-user",
        {
          GrantUserGoneError: class extends Error {},
          getAsUser: () => {
            dmsCalls += 1;
            return Promise.resolve({ isOk: true, body: {} });
          },
        },
      ],
    ]),
  );
  refusal = require("../dist/analyst/refusal.js");
  catalog = require("../dist/analyst/catalog.js");
});

after(() => restore());

/** @param {Promise<unknown>} read */
async function assertFailsClosed(read) {
  await assert.rejects(read, (err) => {
    assert.ok(err instanceof refusal.AnalystRefusal);
    assert.equal(err.status, HTTP_SERVICE_UNAVAILABLE);
    assert.equal(err.reason, "exclusions_unavailable");
    return true;
  });
  assert.equal(dmsCalls, 0, "read the DMS without the exclusion list");
}

void test("rows are refused, reading nothing, when the exclusion list cannot be read", async () => {
  await assertFailsClosed(
    catalog.readRows(IDENTITY, "/sales", "content", new URLSearchParams()),
  );
});

void test("describing a page is refused when the exclusion list cannot be read", async () => {
  await assertFailsClosed(catalog.describePage(IDENTITY, "/sales"));
});
