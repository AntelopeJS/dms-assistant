import { expect } from "chai";
import { Client } from "pg";
import { checkDatabase } from "../implementations/dms-builder/engine/database-check";
import {
  closedPort,
  type Container,
  dockerAvailable,
  LIVE_SUITE_NOTE,
  removeContainer,
  silentServer,
  START_TIMEOUT_MS,
  startContainer,
  waitFor,
  secretOf,
} from "./helpers/database-servers";

const TIMEOUT_MS = 1000;
const ADMIN_SECRET = secretOf("admin");
const WRONG_SECRET = secretOf("wrong");
const ROLES = ["reader", "writer", "inserter", "blind"];

const SETUP = [
  "CREATE TABLE orders (id int PRIMARY KEY, total int)",
  "CREATE TABLE notes (id int PRIMARY KEY)",
  ...ROLES.map(
    (role) => `CREATE ROLE ${role} LOGIN PASSWORD '${secretOf(role)}'`,
  ),
  "GRANT USAGE ON SCHEMA public TO reader, writer, inserter, blind",
  "GRANT SELECT ON ALL TABLES IN SCHEMA public TO reader",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO writer",
  "GRANT INSERT ON orders TO inserter",
];

const suite = dockerAvailable ? describe : describe.skip;

suite(`checking a PostgreSQL database live${LIVE_SUITE_NOTE}`, function () {
  let server: Container | undefined;

  function urlOf(user: string, password = secretOf(user), database = "shop") {
    return `postgres://${user}:${password}@127.0.0.1:${server?.port}/${database}`;
  }

  async function connectAs(user: string, database: string) {
    const client = new Client({
      connectionString: `postgres://${user}:${ADMIN_SECRET}@127.0.0.1:${server?.port}/${database}`,
    });
    await client.connect();
    return client;
  }

  before(async function () {
    this.timeout(START_TIMEOUT_MS);
    server = await startContainer("postgres:18", 5432, [
      "-e",
      `POSTGRES_PASSWORD=${ADMIN_SECRET}`,
    ]);
    await waitFor("PostgreSQL", async () => {
      try {
        await (await connectAs("postgres", "postgres")).end();
        return true;
      } catch {
        return false;
      }
    });
    const admin = await connectAs("postgres", "postgres");
    await admin.query("CREATE DATABASE shop");
    await admin.end();
    const owner = await connectAs("postgres", "shop");
    for (const statement of SETUP) {
      await owner.query(statement);
    }
    await owner.end();
  });

  after(async function () {
    this.timeout(START_TIMEOUT_MS);
    await removeContainer(server);
  });

  it("answers read access and no write access to a role that may only SELECT", async () => {
    const answer = await checkDatabase("postgres", urlOf("reader"), TIMEOUT_MS);
    expect(answer).to.include({
      reachable: true,
      user: "reader",
      canRead: true,
      canWrite: false,
    });
    expect(answer.latencyMs).to.be.a("number");
    expect(answer).to.not.have.property("reason");
  });

  it("answers write access to a role that may write", async () => {
    const answer = await checkDatabase("postgres", urlOf("writer"), TIMEOUT_MS);
    expect(answer).to.include({
      user: "writer",
      canRead: true,
      canWrite: true,
    });
  });

  it("answers write access without read access to a role that may only INSERT", async () => {
    const answer = await checkDatabase(
      "postgres",
      urlOf("inserter"),
      TIMEOUT_MS,
    );
    expect(answer).to.include({
      reachable: true,
      user: "inserter",
      canRead: false,
      canWrite: true,
    });
    expect(answer.reason).to.be.a("string");
  });

  it("answers no access, with a reason, to a role that sees tables and may use none", async () => {
    const answer = await checkDatabase("postgres", urlOf("blind"), TIMEOUT_MS);
    expect(answer).to.include({ canRead: false, canWrite: false });
    expect(answer.reason).to.equal("This account cannot read this database.");
  });

  it("answers a refused password as a server that answered, without the password", async () => {
    const answer = await checkDatabase(
      "postgres",
      urlOf("reader", WRONG_SECRET),
      TIMEOUT_MS,
    );
    expect(answer).to.deep.equal({
      reachable: true,
      canRead: false,
      canWrite: false,
      reason: "The database refused this user name or password.",
    });
    expect(JSON.stringify(answer)).to.not.include(WRONG_SECRET);
  });

  it("answers a database the server does not have as a server that answered", async () => {
    const answer = await checkDatabase(
      "postgres",
      urlOf("reader", undefined, "missing"),
      TIMEOUT_MS,
    );
    expect(answer).to.include({ reachable: true, canRead: false });
    expect(answer.reason).to.equal(
      "The server has no database with this name.",
    );
  });

  it("answers a port nothing listens on as unreachable, within the timeout", async () => {
    const port = await closedPort();
    const started = performance.now();
    const answer = await checkDatabase(
      "postgres",
      `postgres://reader:${WRONG_SECRET}@127.0.0.1:${port}/shop`,
      TIMEOUT_MS,
    );
    expect(performance.now() - started).to.be.lessThan(TIMEOUT_MS);
    expect(answer).to.include({
      reachable: false,
      canRead: false,
      canWrite: false,
    });
    expect(JSON.stringify(answer)).to.not.include(WRONG_SECRET);
  });

  it("answers a server that never speaks as unreachable, within the deadline", async () => {
    const silent = await silentServer();
    try {
      const started = performance.now();
      const answer = await checkDatabase(
        "postgres",
        `postgres://reader:${WRONG_SECRET}@127.0.0.1:${silent.port}/shop`,
        TIMEOUT_MS,
      );
      expect(performance.now() - started).to.be.lessThan(TIMEOUT_MS * 3);
      expect(answer).to.include({ reachable: false });
      expect(answer.reason).to.equal("The database did not answer in time.");
    } finally {
      await silent.close();
    }
  });
});
