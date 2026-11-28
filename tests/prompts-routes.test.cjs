const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  OWNER,
  answer,
  bodyOf,
  reset,
  sidecar,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");
const {
  PAGE_LOCALES,
  isTranslated,
  readLocale,
} = require("./helpers/page-locales.cjs");

const harness = useRouteHarness();

const PROMPT = {
  id: "p-1",
  ownerId: OWNER._id,
  name: "Weekly revenue",
  text: "Summarise last week's revenue per region.",
  createdAtMs: 1_700_000_000_000,
  updatedAtMs: 1_700_000_000_000,
};

const RefusalSchema = z.object({
  code: z.string(),
  field: z.string().optional(),
  message: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});

function controller() {
  return new harness.routes.AISavedPromptsController();
}

/** Asserts a refusal names the field, carries a key both locales translate, and reached no sidecar. */
function assertRefusal(result, status, field, key) {
  assert.ok(result instanceof HTTPResult);
  assert.equal(result.getStatus(), status);
  const body = bodyOf(RefusalSchema, result);
  assert.equal(body.field, field);
  assert.equal(body.message, `$dms_assistant.errors.${key}`);
  for (const file of PAGE_LOCALES) {
    assert.ok(isTranslated(readLocale(file), body.message), `${file} ${key}`);
  }
  return body;
}

void test("lists the prompts of the signed-in member: the owner comes from the session (fails a list that names no owner)", async () => {
  reset();
  answer("GET", "/prompts", 200, { results: [PROMPT], total: 1 });
  const page = await controller().list(OWNER);
  assert.deepEqual(sidecar.requests[0].query, { owner: OWNER._id });
  assert.deepEqual(page, { results: [PROMPT], total: 1 });
});

void test("saves a prompt for the signed-in member, the owner stamped from the session and the fields trimmed, whatever owner the body claims", async () => {
  reset();
  answer("POST", "/prompts", 200, PROMPT);
  const saved = await controller().create(OWNER, {
    owner: "someone-else",
    name: "  Weekly revenue ",
    text: " Summarise last week's revenue per region. ",
  });
  assert.deepEqual(saved, PROMPT);
  assert.deepEqual(sidecar.requests[0].body, {
    owner: OWNER._id,
    name: "Weekly revenue",
    text: "Summarise last week's revenue per region.",
  });
});

void test("refuses a prompt without a name, without a text, over the caps or not an object, naming the field with a translated reason and sending nothing", async () => {
  const refused = [
    [{ text: "t" }, "name", "prompt_name_required"],
    [{ name: "   ", text: "t" }, "name", "prompt_name_required"],
    [{ name: "n".repeat(81), text: "t" }, "name", "prompt_name_too_long"],
    [{ name: "n" }, "text", "prompt_text_required"],
    [{ name: "n", text: "" }, "text", "prompt_text_required"],
    [{ name: "n", text: "x".repeat(20_001) }, "text", "prompt_text_too_long"],
    [undefined, "name", "prompt_name_required"],
  ];
  for (const [body, field, key] of refused) {
    reset();
    answer("POST", "/prompts", 200, PROMPT);
    const result = await controller().create(OWNER, body);
    const refusal = assertRefusal(result, 400, field, key);
    if (key.endsWith("too_long")) {
      assert.equal(refusal.params.max, field === "name" ? 80 : 20_000);
    }
    assert.deepEqual(sidecar.requests, [], key);
  }
});

void test("translates the sidecar's duplicate-name refusal under the name field, naming the name", async () => {
  reset();
  answer("POST", "/prompts", 409, {
    code: "duplicate_name",
    message: 'A saved prompt is already named "Weekly revenue".',
  });
  const result = await controller().create(OWNER, {
    name: "Weekly revenue",
    text: "again",
  });
  const refusal = assertRefusal(result, 409, "name", "prompt_name_taken");
  assert.equal(refusal.code, "duplicate_name");
  assert.deepEqual(refusal.params, { name: "Weekly revenue" });
});

void test("forwards any other refusal of the sidecar with its message", async () => {
  reset();
  answer("POST", "/prompts", 400, { message: "Invalid saved prompt." });
  const result = await controller().create(OWNER, { name: "n", text: "t" });
  assert.ok(result instanceof HTTPResult);
  assert.equal(result.getStatus(), 400);
  assert.deepEqual(bodyOf(z.json(), result), {
    message: "Invalid saved prompt.",
  });
});

void test("edits a prompt with its id encoded once and the owner stamped, and refuses an edit that changes nothing", async () => {
  reset();
  answer("PUT", "/prompts/p%201", 200, { ...PROMPT, id: "p 1" });
  const edited = await controller().update(encodeURIComponent("p 1"), OWNER, {
    text: " Edited ",
  });
  assert.deepEqual(edited, { ...PROMPT, id: "p 1" });
  assert.equal(sidecar.requests[0].rawPath, "/prompts/p%201");
  assert.deepEqual(sidecar.requests[0].body, {
    owner: OWNER._id,
    text: "Edited",
  });
  reset();
  answer("PUT", "/prompts/p-1", 200, PROMPT);
  const empty = await controller().update("p-1", OWNER, {});
  assertRefusal(empty, 400, undefined, "prompt_body");
  assert.deepEqual(sidecar.requests, []);
});

void test("translates a renamed prompt's duplicate-name refusal, and leaves a text-only edit's 409 as the sidecar said it", async () => {
  reset();
  answer("PUT", "/prompts/p-1", 409, {
    code: "duplicate_name",
    message: "taken",
  });
  const renamed = await controller().update("p-1", OWNER, { name: "Second" });
  const refusal = assertRefusal(renamed, 409, "name", "prompt_name_taken");
  assert.deepEqual(refusal.params, { name: "Second" });
  const textOnly = await controller().update("p-1", OWNER, { text: "x" });
  assert.ok(textOnly instanceof HTTPResult);
  assert.deepEqual(bodyOf(z.json(), textOnly), { message: "taken" });
});

void test("deletes a prompt for the signed-in member, the owner in the query", async () => {
  reset();
  answer("DELETE", "/prompts/p-1", 200, { deleted: "p-1" });
  const deleted = await controller().remove("p-1", OWNER);
  assert.deepEqual(deleted, { deleted: "p-1" });
  const [request] = sidecar.requests;
  assert.equal(request.method, "DELETE");
  assert.deepEqual(request.query, { owner: OWNER._id });
});

void test("answers 503 with a message on every route while the sidecar is down", async () => {
  reset();
  sidecar.isDown = true;
  const answers = [
    await controller().list(OWNER),
    await controller().create(OWNER, { name: "n", text: "t" }),
    await controller().update("p-1", OWNER, { text: "t" }),
    await controller().remove("p-1", OWNER),
  ];
  for (const result of answers) {
    assert.ok(result instanceof HTTPResult);
    assert.equal(result.getStatus(), 503);
    assert.deepEqual(bodyOf(z.json(), result), {
      message: "The assistant isn't running.",
    });
  }
});
