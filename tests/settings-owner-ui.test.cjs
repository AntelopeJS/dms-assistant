const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  answer,
  bodyOf,
  reset,
  sidecar,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();
const MARKER = "1";

/** Every form a request can write a guard rail in: the form's own fields, then the sidecar's stored keys. */
const GUARD_RAIL_WRITES = [
  [{ defaultModeClaude: "auto" }, { defaultModes: { claude: "auto" } }],
  [{ defaultModeCodex: "plan" }, { defaultModes: { codex: "plan" } }],
  [{ safeMode: false }, { generationMode: "vibe" }],
  [{ generationMode: "vibe" }, { generationMode: "vibe" }],
  [{ defaultModes: { claude: "auto" } }, { defaultModes: { claude: "auto" } }],
  [{ alwaysAskDependencies: false }, { alwaysAskDependencies: false }],
  [{ alwaysAskBlockRemoval: false }, { alwaysAskBlockRemoval: false }],
  [{ allowLocalSkills: true }, { allowLocalSkills: true }],
];

/**
 * @param {Record<string, import("../src/sidecar/json-body").JsonBody>} body
 * @param {string} [marker]
 */
function putSettings(body, marker) {
  return new harness.routes.AISettingsController().updateSettings(body, marker);
}

/** Fails on a PUT that forwards a guard rail the owner's session wrote without the assistant UI's header, as a form block on a page the assistant built does. */
void test("refuses each form of a guard-rail write without the assistant UI's header, nothing reaching the sidecar", async () => {
  for (const [body] of GUARD_RAIL_WRITES) {
    for (const marker of [undefined, "", "true", "0"]) {
      reset();
      answer("PUT", "/settings", 200, {});
      const result = await putSettings(body, marker);
      const label = JSON.stringify([body, marker]);
      assert.ok(result instanceof HTTPResult, label);
      assert.equal(result.getStatus(), 403, label);
      assert.equal(bodyOf(z.json(), result).code, "forbidden", label);
      assert.deepEqual(sidecar.requests, [], label);
    }
  }
});

/** Fails on a PUT that refuses the assistant's own Guard rails card, or that forwards a guard rail in a shape the sidecar does not read. */
void test("forwards each form of a guard-rail write that carries the assistant UI's header", async () => {
  for (const [body, forwarded] of GUARD_RAIL_WRITES) {
    reset();
    answer("PUT", "/settings", 200, {});
    const result = await putSettings(body, MARKER);
    const label = JSON.stringify(body);
    assert.ok(!(result instanceof HTTPResult), label);
    assert.deepEqual(
      sidecar.requests.map((request) => [request.method, request.body]),
      [["PUT", forwarded]],
      label,
    );
  }
});

/** Fails on a PUT that checks only the first key, or only the keys that are not free: a free key must not carry a guard rail through. */
void test("refuses a free key and a guard rail sent together as a whole", async () => {
  reset();
  answer("PUT", "/settings", 200, {});
  const result = await putSettings({ thinking: "low", allowLocalSkills: true });
  assert.ok(result instanceof HTTPResult);
  assert.equal(result.getStatus(), 403);
  assert.deepEqual(sidecar.requests, []);
});

/** Fails on a PUT that lets through a key it does not know: a setting added to the sidecar later is a guard rail until named free. */
void test("refuses a key the module does not name as free", async () => {
  reset();
  answer("PUT", "/settings", 200, {});
  const result = await putSettings({ approvalPolicy: "never" });
  assert.ok(result instanceof HTTPResult);
  assert.equal(result.getStatus(), 403);
  assert.deepEqual(sidecar.requests, []);
});
