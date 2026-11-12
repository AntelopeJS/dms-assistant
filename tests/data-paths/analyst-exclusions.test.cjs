const assert = require("node:assert/strict");
const { z } = require("zod");
const { analyst } = require("./helpers/assistant.cjs");
const { builtAnalystTools } = require("./helpers/analyst-tools.cjs");
const { call } = require("./helpers/dms.cjs");
const {
  SALES_A,
  SALES_PAGE_ID,
  openGrant,
  person,
  seedPeople,
} = require("./helpers/people.cjs");

const REPORT_PAGE_ID = "dms-ai-test-report";
const FEED_PAGE_ID = "dms-ai-test-feed";
const EXCLUSIONS = "/ai/exclusions";
const CANDIDATES = `${EXCLUSIONS}/candidates`;
const EXCLUDED_FIELD = "amount";
const GONE_ROUTE = "/api/dms-ai-test/removed-long-ago";
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const SEED_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 20_000;

const Pages = z.object({ pages: z.array(z.object({ path: z.string() })) });
const Column = z.looseObject({
  field: z.string(),
  sortable: z.boolean(),
  filterModes: z.array(z.string()),
  redacted: z.boolean().optional(),
});
const Tables = z.object({
  tables: z.array(
    z.looseObject({
      id: z.string(),
      searchable: z.boolean(),
      columns: z.array(Column),
    }),
  ),
});
const Rows = z.object({ rows: z.array(z.looseObject({})) });
const Refusal = z.object({ error: z.string(), detail: z.string() });
const Saved = z.object({
  _id: z.string().optional(),
  route: z.string(),
  fields: z.array(z.string()),
});
const Candidates = z.object({
  pages: z.array(
    z.object({
      path: z.string(),
      tables: z.array(z.object({ id: z.string(), route: z.string() })),
    }),
  ),
  routes: z.array(
    z.object({
      route: z.string(),
      fields: z.array(
        z.object({
          field: z.string(),
          isExcluded: z.boolean(),
          isShown: z.boolean(),
        }),
      ),
    }),
  ),
});
const Entries = z.object({
  results: z.array(
    z.object({
      _id: z.string(),
      route: z.string(),
      fields: z.array(z.string()),
      covers: z.string(),
      status: z.string(),
    }),
  ),
});
const Loaded = z.looseObject({
  columns: z.array(z.string()),
  samples: z.array(z.looseObject({})),
});
const Computed = z.object({ result: z.json() });

/** @type {Map<string, Promise<string>>} */
const grants = new Map();

/**
 * One grant per user for the whole file: the backend caps a user's streams.
 *
 * @param {string} name
 * @returns {Promise<string>}
 */
function grantOf(name) {
  let grant = grants.get(name);
  if (grant === undefined) {
    grant = openGrant(name).then((opened) => opened.grant);
    grants.set(name, grant);
  }
  return grant;
}

/** @param {string} pageId */
async function routeOfPage(pageId) {
  const { token } = person("ownerA");
  const answer = await call(CANDIDATES, Candidates, { token });
  assert.ok(answer.body, answer.text);
  const page = answer.body.pages.find((p) => p.path.includes(pageId));
  assert.ok(page, `${pageId} is not a candidate: ${answer.text}`);
  const [table] = page.tables;
  assert.ok(table, answer.text);
  return table.route;
}

/**
 * @param {string} route
 * @param {string[]} fields
 */
async function save(route, fields) {
  const { token } = person("ownerA");
  const body = { route, fields };
  const saved = await call(EXCLUSIONS, Saved, { token, method: "PUT", body });
  assert.ok(saved.body, saved.text);
  return saved.body;
}

/**
 * @param {string} route
 * @param {string} field
 */
async function exclude(route, field) {
  const { _id } = await save(route, [field]);
  assert.ok(_id);
  return _id;
}

async function entries() {
  const { token } = person("ownerA");
  const list = await call(EXCLUSIONS, Entries, { token });
  assert.ok(list.body, list.text);
  return list.body.results;
}

/** @param {string} id */
async function include(id) {
  const { token } = person("ownerA");
  const removed = await call(`${EXCLUSIONS}/${id}`, z.unknown(), {
    token,
    method: "DELETE",
  });
  assert.equal(removed.status, HTTP_OK, removed.text);
}

/**
 * @param {string} grant
 * @param {string} pageId
 */
async function described(grant, pageId) {
  const pages = await analyst("pages", Pages, { grant });
  const page = pages.body?.pages.find((p) => p.path.includes(pageId));
  assert.ok(page, `${pageId} is not readable: ${pages.text}`);
  const query = new URLSearchParams({ page: page.path });
  const tables = await analyst("tables", Tables, { grant, query });
  assert.ok(tables.body, tables.text);
  const [table] = tables.body.tables;
  assert.ok(table, tables.text);
  return { page: page.path, table };
}

/**
 * @param {string} grant
 * @param {string} pageId
 * @param {Record<string, string>} [params]
 */
async function rowsOf(grant, pageId, params = {}) {
  const { page, table } = await described(grant, pageId);
  const query = new URLSearchParams({ page, table: table.id, ...params });
  return analyst("rows", Rows, { grant, query });
}

/**
 * @param {Awaited<ReturnType<typeof rowsOf>>} answer
 * @param {string} error
 */
function assertRefused(answer, error) {
  assert.equal(answer.status, HTTP_FORBIDDEN, answer.text);
  const refusal = Refusal.parse(JSON.parse(answer.text));
  assert.equal(refusal.error, error);
  assert.match(refusal.detail, /excluded/);
}

before(async function () {
  this.timeout(SEED_TIMEOUT_MS);
  await seedPeople();
});

describe("[data paths] an excluded field on a data route", function () {
  this.timeout(TEST_TIMEOUT_MS);
  /** @type {string} */
  let entryId;
  /** @type {string} */
  let grant;

  before(async () => {
    entryId = await exclude(await routeOfPage(SALES_PAGE_ID), EXCLUDED_FIELD);
    grant = await grantOf("ownerA");
  });

  after(() => include(entryId));

  for (const pageId of [SALES_PAGE_ID, REPORT_PAGE_ID]) {
    it(`is described as redacted on ${pageId}, with search off`, async () => {
      const { table } = await described(grant, pageId);
      const amount = table.columns.find((c) => c.field === EXCLUDED_FIELD);
      assert.deepEqual(
        { ...amount, header: undefined, type: undefined },
        {
          field: EXCLUDED_FIELD,
          sortable: false,
          filterModes: [],
          redacted: true,
          header: undefined,
          type: undefined,
        },
      );
      assert.equal(table.searchable, false);
    });

    it(`is absent from the rows of ${pageId}, the others kept`, async () => {
      const answer = await rowsOf(grant, pageId);
      assert.ok(answer.body, answer.text);
      assert.equal(answer.body.rows.length, SALES_A.length);
      for (const row of answer.body.rows) {
        assert.deepEqual(Object.keys(row).sort(), ["_id", "label"]);
      }
    });
  }

  it("is absent from analyst_load's columns and samples and from analyst_compute", async () => {
    const { page, table } = await described(grant, SALES_PAGE_ID);
    const run = await builtAnalystTools(grant);
    const loaded = await run("analyst_load", {
      name: "sales",
      page,
      table: table.id,
    });
    assert.equal(loaded.isError, false, loaded.text);
    const summary = Loaded.parse(loaded.body);
    assert.ok(!summary.columns.includes(EXCLUDED_FIELD), loaded.text);
    for (const sample of summary.samples) {
      assert.ok(!Object.hasOwn(sample, EXCLUDED_FIELD), loaded.text);
    }
    const computed = await run("analyst_compute", {
      code: `return sales.some((sale) => "${EXCLUDED_FIELD}" in sale);`,
    });
    assert.equal(computed.isError, false, computed.text);
    assert.equal(Computed.parse(computed.body).result, false);
  });

  it("refuses a filter on it, saying why", async () => {
    assertRefused(
      await rowsOf(grant, SALES_PAGE_ID, {
        [`filter_${EXCLUDED_FIELD}`]: "eq:120",
      }),
      "excluded_filter",
    );
  });

  it("refuses a sort on it, saying why", async () => {
    assertRefused(
      await rowsOf(grant, SALES_PAGE_ID, { sortKey: EXCLUDED_FIELD }),
      "excluded_sort",
    );
  });

  it("refuses a search on the table, saying why", async () => {
    assertRefused(
      await rowsOf(grant, SALES_PAGE_ID, { search: "A-north" }),
      "excluded_search",
    );
  });

  it("shows the owner every page and table its route covers, and its fields", async () => {
    const entry = (await entries()).find((e) => e._id === entryId);
    assert.ok(entry);
    assert.equal(entry.status, "active");
    assert.deepEqual(entry.fields, [EXCLUDED_FIELD]);
    assert.match(entry.covers, /Sales ›/);
    assert.match(entry.covers, /Sales report ›/);
  });

  it("lists the route's columns for the owner to check, the excluded one checked", async () => {
    const { token } = person("ownerA");
    const answer = await call(CANDIDATES, Candidates, { token });
    assert.ok(answer.body, answer.text);
    const route = await routeOfPage(SALES_PAGE_ID);
    const checklist = answer.body.routes.find((r) => r.route === route);
    const byField = new Map(checklist?.fields.map((f) => [f.field, f]));
    assert.deepEqual(byField.get(EXCLUDED_FIELD), {
      field: EXCLUDED_FIELD,
      isExcluded: true,
      isShown: true,
    });
    assert.equal(byField.get("label")?.isExcluded, false);
  });
});

describe("[data paths] an exclusion on a field the table shows no column for", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("refuses search on the table without describing a column", async () => {
    const grant = await grantOf("ownerA");
    const id = await exclude(await routeOfPage(FEED_PAGE_ID), "note");
    try {
      const { table } = await described(grant, FEED_PAGE_ID);
      assert.ok(table.columns.every((c) => c.redacted !== true));
      assertRefused(
        await rowsOf(grant, FEED_PAGE_ID, { search: "hidden" }),
        "excluded_search",
      );
    } finally {
      await include(id);
    }
  });
});

describe("[data paths] the exclusion list", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("reads the field again once its entry is removed", async () => {
    const grant = await grantOf("ownerA");
    const id = await exclude(await routeOfPage(SALES_PAGE_ID), EXCLUDED_FIELD);
    await include(id);
    const answer = await rowsOf(grant, SALES_PAGE_ID);
    assert.ok(answer.body, answer.text);
    for (const row of answer.body.rows) {
      assert.ok(Object.hasOwn(row, EXCLUDED_FIELD), answer.text);
    }
  });

  it("keeps an entry nothing shows any more, marked not found, its field still offered", async () => {
    const id = await exclude(GONE_ROUTE, "email");
    try {
      const entry = (await entries()).find((e) => e._id === id);
      assert.equal(entry?.route, GONE_ROUTE);
      assert.equal(entry?.status, "not_found");
      assert.equal(entry?.covers, "");
      const { token } = person("ownerA");
      const answer = await call(CANDIDATES, Candidates, { token });
      const gone = answer.body?.routes.find((r) => r.route === GONE_ROUTE);
      assert.deepEqual(gone?.fields, [
        { field: "email", isExcluded: true, isShown: false },
      ]);
    } finally {
      await include(id);
    }
  });

  it("keeps one entry per route, without its query string, saving replaces its fields", async () => {
    const first = await exclude(`${GONE_ROUTE}?tab=open`, "email");
    try {
      const saved = await save(GONE_ROUTE, ["phone", "email", "phone"]);
      assert.equal(saved._id, first);
      const onRoute = (await entries()).filter((e) => e.route === GONE_ROUTE);
      assert.deepEqual(
        onRoute.map((e) => e.fields),
        [["email", "phone"]],
      );
    } finally {
      await include(first);
    }
  });

  it("removes a route's entry when its last field is unchecked", async () => {
    await exclude(GONE_ROUTE, "email");
    await save(GONE_ROUTE, []);
    assert.ok(!(await entries()).some((e) => e.route === GONE_ROUTE));
  });

  it("is closed to a user who is not an owner, and so is its page", async () => {
    const { token } = person("readerA");
    for (const [path, method] of [
      [EXCLUSIONS, "GET"],
      [CANDIDATES, "GET"],
      [EXCLUSIONS, "PUT"],
      [`${EXCLUSIONS}/any`, "DELETE"],
    ]) {
      const answer = await call(path, z.unknown(), {
        token,
        method,
        body:
          method === "PUT" ? { route: GONE_ROUTE, fields: ["x"] } : undefined,
      });
      assert.equal(answer.status, HTTP_FORBIDDEN, `${method} ${path}`);
    }
    const pages = await analyst("pages", Pages, {
      grant: await grantOf("readerA"),
    });
    assert.ok(pages.body, pages.text);
    assert.ok(!pages.body.pages.some((p) => p.path.includes("exclusions")));
    const ownerPages = await analyst("pages", Pages, {
      grant: await grantOf("ownerA"),
    });
    assert.ok(
      ownerPages.body?.pages.some((p) => p.path.includes("exclusions")),
    );
  });
});
