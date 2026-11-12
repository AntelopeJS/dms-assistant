const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  answer,
  reset,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

void test("a usage answer of the wrong shape reads as the empty one (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/metrics/usage", 200, { days: 3, totalTokens: "x" });
  const metrics = new harness.routes.AIMetricsController();

  assert.deepEqual((await metrics.usage("14")).series[0].data, []);
  assert.equal((await metrics.usageSummary("14")).items.length, 2);
});

void test("a settings answer of the wrong shape locks and defaults nothing on the form (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/settings", 200, {
    providers: { codex: "down" },
    builderAvailable: "no",
    defaults: "none",
  });

  const options = await harness.routes.applySidecarSettings(new Set(), {
    fields: [
      {
        id: "provider",
        type: "select",
        component: {
          type: "select",
          options: { items: [{ value: "claude" }, { value: "codex" }] },
        },
      },
    ],
  });

  const [provider] = options.fields;
  assert.deepEqual(provider.component.options.items, [
    { value: "claude" },
    { value: "codex" },
  ]);
  assert.equal(provider.offersDefault, undefined);
});
