const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  OWNER,
  answer,
  bodyOf,
  context,
  reset,
  sidecar,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

const HOSTILE_TITLE = "<img src=x onerror=alert(1)>";

/** An artifact as the sidecar lists it. */
const SUMMARY = {
  id: "a-1",
  conversationId: "c-1",
  ownerId: OWNER._id,
  createdBy: OWNER.name,
  agent: "claude",
  createdAtMs: Date.UTC(2026, 10, 27, 9, 30),
  kind: "table",
  title: HOSTILE_TITLE,
  blocks: 1,
};

/** The same artifact with its data, as the sidecar stores it. */
const DETAIL = {
  ...SUMMARY,
  title: undefined,
  blocks: undefined,
  spec: {
    title: HOSTILE_TITLE,
    blocks: [
      {
        type: "table",
        columns: [{ label: "Customer" }],
        rows: [[HOSTILE_TITLE]],
      },
    ],
  },
};

void test("lists the signed-in user's artifacts: the table query and the viewer reach the sidecar, each row keyed by its id with an ISO time", async () => {
  reset();
  answer("GET", "/artifacts", 200, { results: [SUMMARY], total: 1 });
  const page = await new harness.routes.AIArtifactsController().list(
    context("offset=30&limit=30&search=refund&conversationId=c-1"),
    OWNER,
  );
  const [request] = sidecar.requests;
  assert.deepEqual(request.query, {
    offset: "30",
    limit: "30",
    search: "refund",
    conversationId: "c-1",
    viewer: OWNER._id,
  });
  assert.ok(!(page instanceof HTTPResult));
  assert.equal(page.total, 1);
  assert.equal(page.results[0]._id, "a-1");
  assert.equal(page.results[0].createdAt, "2026-11-27T09:30:00.000Z");
  assert.equal(page.results[0].title, HOSTILE_TITLE);
});

void test("reads one artifact for the signed-in user and forwards its data untouched, hostile text included as text (fails a route that rewrites it)", async () => {
  reset();
  answer("GET", "/artifacts/a-1", 200, DETAIL);
  const artifact = await new harness.routes.AIArtifactsController().detail(
    "a-1",
    OWNER,
  );
  const [request] = sidecar.requests;
  assert.equal(request.path, "/artifacts/a-1");
  assert.deepEqual(request.query, { viewer: OWNER._id });
  assert.ok(!(artifact instanceof HTTPResult));
  assert.deepEqual(artifact.spec, DETAIL.spec);
});

void test("passes the sidecar's refusal of an unknown or foreign artifact on, with its message", async () => {
  reset();
  answer("GET", "/artifacts/nope", 404, { message: "Unknown artifact." });
  const result = await new harness.routes.AIArtifactsController().detail(
    "nope",
    OWNER,
  );
  assert.ok(result instanceof HTTPResult);
  assert.equal(result.getStatus(), 404);
  assert.deepEqual(bodyOf(z.json(), result), { message: "Unknown artifact." });
});

void test("refuses an artifact answer of another shape rather than forwarding it", async () => {
  reset();
  answer("GET", "/artifacts/a-1", 200, { id: "a-1", spec: "not an object" });
  const result = await new harness.routes.AIArtifactsController().detail(
    "a-1",
    OWNER,
  );
  assert.ok(result instanceof HTTPResult);
  assert.equal(result.getStatus(), 502);
});

void test("forwards the kind filter of the Artifacts page as the sidecar's kind parameter", async () => {
  reset();
  answer("GET", "/artifacts", 200, { results: [], total: 0 });
  await new harness.routes.AIArtifactsController().list(
    context("filter_kind=is:chart"),
    OWNER,
  );
  assert.deepEqual(sidecar.requests[0].query, {
    kind: "chart",
    viewer: OWNER._id,
  });
});

void test("asks Delete's confirmation named after the artifact, in the error colour, for the signed-in user", async () => {
  reset();
  answer("GET", "/artifacts/a-1", 200, DETAIL);
  const dialog = await new harness.routes.AIArtifactsController().deleteConfirm(
    "a-1",
    OWNER,
  );
  assert.ok(!(dialog instanceof HTTPResult));
  assert.equal(
    dialog.title,
    "$dms_assistant.artifacts_table.delete_confirm.title",
  );
  assert.equal(
    dialog.description,
    "$dms_assistant.artifacts_table.delete_confirm.description",
  );
  assert.equal(
    dialog.confirmLabel,
    "$dms_assistant.artifacts_table.delete_confirm.confirm",
  );
  assert.equal(dialog.color, "error");
  assert.deepEqual(dialog.params, { title: HOSTILE_TITLE });
  assert.deepEqual(sidecar.requests[0].query, { viewer: OWNER._id });
});

void test("deletes for the signed-in user and passes the sidecar's answer, or its refusal, on", async () => {
  reset();
  answer("DELETE", "/artifacts/a-1", 200, { deleted: "a-1" });
  answer("DELETE", "/artifacts/nope", 404, { message: "Unknown artifact." });
  const controller = new harness.routes.AIArtifactsController();
  const deleted = await controller.remove("a-1", OWNER);
  assert.deepEqual(deleted, { deleted: "a-1" });
  assert.equal(sidecar.requests[0].method, "DELETE");
  assert.deepEqual(sidecar.requests[0].query, { viewer: OWNER._id });
  const refused = await controller.remove("nope", OWNER);
  assert.ok(refused instanceof HTTPResult);
  assert.equal(refused.getStatus(), 404);
  assert.deepEqual(bodyOf(z.json(), refused), {
    message: "Unknown artifact.",
  });
});

void test("answers 503 with a message from the list and the detail while the sidecar is down", async () => {
  reset();
  sidecar.isDown = true;
  const controller = new harness.routes.AIArtifactsController();
  for (const result of [
    await controller.list(context(""), OWNER),
    await controller.detail("a-1", OWNER),
  ]) {
    assert.ok(result instanceof HTTPResult);
    assert.equal(result.getStatus(), 503);
    assert.deepEqual(bodyOf(z.json(), result), {
      message: "The assistant isn't running.",
    });
  }
});
