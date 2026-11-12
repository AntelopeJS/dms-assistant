const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const {
  answer,
  bodyOf,
  reset,
  sidecar,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

const JsonSchema = z.json();
const NO_STORE = "no-store";

const STATE = {
  bootId: "boot-1",
  provider: "claude",
  logins: {
    claude: { status: "signed-in", source: "saved", email: "dev@acme.test" },
    codex: { status: "signed-out" },
  },
  codexLoginUrl: "https://auth.openai.com/api/accounts/authorize?state=s",
};

void test("relays the onboarding state uncached", async () => {
  reset();
  answer("GET", "/onboarding", 200, STATE);
  const result = await new harness.routes.AIOnboardingController().state();
  assert.deepEqual(bodyOf(JsonSchema, result), STATE);
  assert.equal(result.getHeaders()["Cache-Control"], NO_STORE);
});

void test("answers 502 when the sidecar's state is not the shape the popup reads", async () => {
  reset();
  answer("GET", "/onboarding", 200, { ...STATE, provider: "gemini" });
  const result = await new harness.routes.AIOnboardingController().state();
  assert.equal(result.getStatus(), 502);
});

void test("answers 503 while the sidecar is down", async () => {
  reset();
  sidecar.isDown = true;
  const result = await new harness.routes.AIOnboardingController().state();
  assert.equal(result.getStatus(), 503);
  assert.equal(result.getHeaders()["Cache-Control"], NO_STORE);
});

void test("relays a pasted token as the only field and answers the check uncached", async () => {
  reset();
  answer("POST", "/onboarding/claude-token", 200, {
    ok: false,
    reason: "rejected",
  });
  const result = await new harness.routes.AIOnboardingController().claudeToken({
    token: "sk-ant-oat01-test-only",
    unexpected: "dropped",
  });
  assert.deepEqual(bodyOf(JsonSchema, result), {
    ok: false,
    reason: "rejected",
  });
  assert.equal(result.getHeaders()["Cache-Control"], NO_STORE);
  assert.deepEqual(
    sidecar.requests.map(({ method, path, body }) => ({ method, path, body })),
    [
      {
        method: "POST",
        path: "/onboarding/claude-token",
        body: { token: "sk-ant-oat01-test-only" },
      },
    ],
  );
});

void test("relays a working token the sidecar could not save as unsaved", async () => {
  reset();
  answer("POST", "/onboarding/claude-token", 200, {
    ok: false,
    reason: "unsaved",
  });
  const result = await new harness.routes.AIOnboardingController().claudeToken({
    token: "sk-ant-oat01-test-only",
  });
  assert.equal(result.getStatus(), 200);
  assert.deepEqual(bodyOf(JsonSchema, result), {
    ok: false,
    reason: "unsaved",
  });
});

void test("refuses a token body without a token before it reaches the sidecar", async () => {
  reset();
  const controller = new harness.routes.AIOnboardingController();
  for (const body of [undefined, {}, { token: 7 }]) {
    const result = await controller.claudeToken(body);
    assert.equal(result.getStatus(), 400);
  }
  assert.deepEqual(sidecar.requests, []);
});

void test("relays the provider choice and refuses an unknown one before the sidecar", async () => {
  reset();
  answer("POST", "/onboarding/provider", 200, { ...STATE, provider: "codex" });
  const controller = new harness.routes.AIOnboardingController();
  const chosen = await controller.provider({ provider: "codex" });
  assert.deepEqual(bodyOf(JsonSchema, chosen), { ...STATE, provider: "codex" });
  assert.equal(chosen.getHeaders()["Cache-Control"], NO_STORE);
  const refused = await controller.provider({ provider: "gemini" });
  assert.equal(refused.getStatus(), 400);
  assert.equal(sidecar.requests.length, 1);
});
