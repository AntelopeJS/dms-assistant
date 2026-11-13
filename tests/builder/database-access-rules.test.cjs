const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  postgresAccess,
} = require("../../dist/builder/implementations/dms-builder/engine/access-postgres.js");
const {
  mongoAccess,
} = require("../../dist/builder/implementations/dms-builder/engine/access-mongodb.js");
const {
  summarizeRelations,
} = require("../../dist/builder/implementations/dms-builder/engine/database-access.js");

const NO_WRITE = { insert: false, update: false, delete: false };
const SELECT_ONLY = { readable: true, ...NO_WRITE };
const NO_PRIVILEGE = { readable: false, ...NO_WRITE };

const ORDERS = { name: "orders", type: "collection" };
const NOTES = { name: "notes", type: "collection" };
const REPORT = { name: "report", type: "view" };

/**
 * @param {string[]} actions
 * @param {{ db?: string, collection?: string, anyResource?: boolean }} resource
 */
function privilege(actions, resource) {
  return { actions, resource };
}

/**
 * @param {Partial<Parameters<typeof mongoAccess>[0]>} grants
 */
function mongo(grants) {
  return mongoAccess({
    database: "shop",
    user: "app",
    privileges: [],
    relations: [ORDERS, NOTES],
    ...grants,
  });
}

/** Fails on an implementation that takes SELECT for write access. */
void test("postgres: a read-only role reads and cannot write", () => {
  assert.deepEqual(postgresAccess([SELECT_ONLY, SELECT_ONLY]), {
    canRead: true,
    canWrite: false,
  });
});

/** Fails on an implementation that needs INSERT in particular, or that needs SELECT to write. */
void test("postgres: INSERT on one table is write access without any read access", () => {
  assert.deepEqual(
    postgresAccess([{ ...NO_PRIVILEGE, insert: true }, NO_PRIVILEGE]),
    { canRead: false, canWrite: true },
  );
});

/** Fails on an implementation that looks at INSERT alone, or at UPDATE or DELETE alone. */
void test("postgres: UPDATE alone and DELETE alone are write access too", () => {
  assert.equal(
    postgresAccess([{ ...NO_PRIVILEGE, update: true }]).canWrite,
    true,
  );
  assert.equal(
    postgresAccess([{ ...NO_PRIVILEGE, delete: true }]).canWrite,
    true,
  );
});

/** Fails on an implementation that counts a visible relation as a readable one. */
void test("postgres: a role that sees tables and may use none of them reads nothing", () => {
  assert.deepEqual(postgresAccess([NO_PRIVILEGE, NO_PRIVILEGE]), {
    canRead: false,
    canWrite: false,
  });
});

/** Fails on an implementation that asks one table for both and not any table for each. */
void test("postgres: the read and the write may sit on different tables", () => {
  assert.deepEqual(
    postgresAccess([SELECT_ONLY, { ...NO_PRIVILEGE, update: true }]),
    { canRead: true, canWrite: true },
  );
});

/** Fails on an implementation that reads `some` of an empty list, which is false. */
void test("postgres: an empty database reads and writes nothing", () => {
  assert.deepEqual(postgresAccess([]), { canRead: true, canWrite: false });
});

/** Fails on an implementation that matches every grant without its database. */
void test("mongodb: a role granted on another database reads nothing here", () => {
  assert.deepEqual(
    mongo({
      privileges: [
        privilege(["find", "insert"], { db: "elsewhere", collection: "" }),
      ],
    }),
    { canRead: false, canWrite: false },
  );
});

/** Fails on an implementation that needs the grant to name the collection. */
void test("mongodb: a read role grants find on every collection of its database", () => {
  assert.deepEqual(
    mongo({
      privileges: [privilege(["find"], { db: "shop", collection: "" })],
    }),
    { canRead: true, canWrite: false },
  );
});

/** Fails on an implementation that reads `remove` as `delete`, or leaves it out. */
void test("mongodb: insert, update or remove on one collection is write access", () => {
  for (const action of ["insert", "update", "remove"]) {
    assert.equal(
      mongo({
        privileges: [privilege([action], { db: "shop", collection: "orders" })],
      }).canWrite,
      true,
      action,
    );
  }
});

/** Fails on an implementation that writes through `find`, or reads through `insert`. */
void test("mongodb: a role that may insert into one collection and find in none reads nothing", () => {
  assert.deepEqual(
    mongo({
      privileges: [privilege(["insert"], { db: "shop", collection: "orders" })],
    }),
    { canRead: false, canWrite: true },
  );
});

/** Fails on an implementation that does not take `db: ""` as every database. */
void test("mongodb: a grant on every database and every collection covers this one", () => {
  assert.deepEqual(
    mongo({
      privileges: [privilege(["find", "update"], { db: "", collection: "" })],
    }),
    { canRead: true, canWrite: true },
  );
});

/** Fails on an implementation that does not take `anyResource` as everything. */
void test("mongodb: an `anyResource` grant covers every collection", () => {
  assert.equal(
    mongo({ privileges: [privilege(["find"], { anyResource: true })] }).canRead,
    true,
  );
});

/** Fails on an implementation that lets a view be written to. */
void test("mongodb: a view is never written to, whatever the grants say", () => {
  assert.deepEqual(
    mongo({
      relations: [REPORT],
      privileges: [
        privilege(["find", "insert"], { db: "shop", collection: "" }),
      ],
    }),
    { canRead: true, canWrite: false },
  );
});

/** Fails on an implementation that counts `system.` collections, which the catalog leaves out. */
void test("mongodb: the system collections count neither as read nor as write", () => {
  assert.deepEqual(
    mongo({
      relations: [{ name: "system.views", type: "collection" }, ORDERS],
      privileges: [
        privilege(["find", "insert"], {
          db: "shop",
          collection: "system.views",
        }),
      ],
    }),
    { canRead: false, canWrite: false },
  );
});

/** Fails on an implementation that reads an empty database as unreadable. */
void test("mongodb: a database with no collection reads and writes nothing", () => {
  assert.deepEqual(mongo({ relations: [] }), {
    canRead: true,
    canWrite: false,
  });
});

/** Fails on an implementation that takes an account without privileges for a server without access control. */
void test("mongodb: a signed-in account with no privilege has no access", () => {
  assert.deepEqual(mongo({ user: "app", privileges: [] }), {
    canRead: false,
    canWrite: false,
  });
});

/** Fails on an implementation that gives a server without access control no privilege at all. */
void test("mongodb: a server without access control gives full privileges", () => {
  assert.deepEqual(mongo({ user: undefined, privileges: [] }), {
    canRead: true,
    canWrite: true,
  });
});

/** Fails on an implementation that reads a server without access control from what the database holds, so an empty one, or one of views, cannot be written to. */
void test("mongodb: a server without access control reads and writes a database that is empty or holds only views", () => {
  for (const relations of [[], [REPORT]]) {
    assert.deepEqual(mongo({ user: undefined, relations }), {
      canRead: true,
      canWrite: true,
    });
  }
});

/** Fails on an implementation that counts a view of a signed-in account as writable. */
void test("mongodb: a signed-in account with every privilege writes to no view and to nothing in an empty database", () => {
  const everything = [
    privilege(["find", "insert", "update", "remove"], { anyResource: true }),
  ];
  assert.deepEqual(mongo({ privileges: everything, relations: [REPORT] }), {
    canRead: true,
    canWrite: false,
  });
  assert.deepEqual(mongo({ privileges: everything, relations: [] }), {
    canRead: true,
    canWrite: false,
  });
});

/** Fails on an implementation that takes a table the account can read for one it can write. */
void test("rethinkdb: tables the account can read and not write mean read access only", () => {
  assert.deepEqual(
    summarizeRelations([
      { readable: true, writable: false },
      { readable: true, writable: false },
    ]),
    { canRead: true, canWrite: false },
  );
});

/** Fails on an implementation that needs every table to be writable. */
void test("rethinkdb: one writable table among read-only ones is write access", () => {
  assert.deepEqual(
    summarizeRelations([
      { readable: true, writable: false },
      { readable: true, writable: true },
    ]),
    { canRead: true, canWrite: true },
  );
});

/** Fails on an implementation that lists the tables and stops there. */
void test("rethinkdb: an account that is refused every table reads nothing", () => {
  assert.deepEqual(
    summarizeRelations([
      { readable: false, writable: false },
      { readable: false, writable: false },
    ]),
    { canRead: false, canWrite: false },
  );
});

/** Fails on an implementation that reads an empty database as unreadable. */
void test("rethinkdb: a database with no table reads and writes nothing", () => {
  assert.deepEqual(summarizeRelations([]), { canRead: true, canWrite: false });
});
