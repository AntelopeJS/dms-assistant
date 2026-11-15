const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ROUTES } = require("../../dist/builder/constants/routes.js");
const { loadDatabaseController } = require("./helpers/database-controller.cjs");

const controller = loadDatabaseController({});
const bound = controller.routes();

/** The routes whose body holds a database URL: the check's, a connection's new URL, and the `.env` values of a connect batch. */
const URL_ROUTES = [
  "POST /database/connections/check",
  "POST /database/connection/url",
  "POST /database/project",
];

/** Fails on a route of the controller that the test does not see, which would leave it out of the checks below. */
void test("the test sees every route of the connect flow", () => {
  const paths = new Set(bound.map((route) => route.path));
  assert.deepEqual(
    Object.values(ROUTES).filter((routePath) => !paths.has(routePath)),
    [],
  );
});

/** Fails on a connect route that a caller without the owner's session reaches, such as one checking the sidecar's token in place of the owner. */
void test("every connect route reads the owner first", () => {
  const open = bound
    .filter((route) => route.reads[0] !== "owner")
    .map((route) => `${route.verb} ${route.path}`);
  assert.deepEqual(open, []);
});

const MARKER = "header:x-dms-ui-assistant";

/** Fails on a connect route that reads another header, such as the sidecar's token, or a URL-taking route that does not read the assistant UI's marker. */
void test("every URL-taking route reads the assistant UI's marker, and no route reads another header", () => {
  const reading = bound.map((route) => [
    `${route.verb} ${route.path}`,
    route.reads.filter((read) => read.startsWith("header:")),
  ]);
  assert.deepEqual(
    reading,
    bound.map((route) => [
      `${route.verb} ${route.path}`,
      URL_ROUTES.includes(`${route.verb} ${route.path}`) ? [MARKER] : [],
    ]),
  );
});

/** What a connect route may read: the owner, the owner's request body, and ids that name an analysis, a connection or a module from a query. */
const ALLOWED_READS = new Set([
  "owner",
  "body",
  "query:id",
  "query:connection",
  "query:module",
  MARKER,
]);

/** Fails on a route that reads a URL from a query, a path or a header, which a link or an image address the agent writes can fill. */
void test("the connect routes read nothing but the owner, the body and ids from a query", () => {
  const reading = bound.flatMap((route) =>
    route.reads
      .filter((read) => !ALLOWED_READS.has(read))
      .map((read) => `${route.verb} ${route.path} ${read}`),
  );
  assert.deepEqual(reading, []);
});

/** Fails on a route that takes its URL from anywhere else than the body of the owner's request. */
void test("a route that takes a URL reads it from the owner's request body alone", () => {
  const reads = URL_ROUTES.map((name) => {
    const [verb, routePath] = name.split(" ");
    return [name, controller.route(verb, routePath).reads];
  });
  assert.deepEqual(
    reads,
    URL_ROUTES.map((name) => [name, ["owner", "body", MARKER]]),
  );
});
