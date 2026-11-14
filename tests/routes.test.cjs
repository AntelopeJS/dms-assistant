const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  CLIENT_TOKEN,
  OWNER,
  answer,
  bodyOf,
  context,
  reset,
  sidecar,
  textOf,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");
const { CHANGE_SET_BASE, ROW } = require("./helpers/fixtures.cjs");

const StatusSchema = z.looseObject({
  status: z.string(),
  isRunning: z.boolean(),
  hasGivenUp: z.boolean(),
});
const harness = useRouteHarness();

void test("translates the Activity table's query and keys each row by its id", async () => {
  reset();
  answer("GET", "/activity", 200, { results: [ROW], total: 1 });
  const page = await new harness.routes.AIActivityController().list(
    context(
      "offset=25&limit=25&search=vat&filter_category=is:changed" +
        "&filter_isReadOnly=is:false&filter_tool=is:Bash&filter_agent=is_not:codex",
    ),
  );
  const [request] = sidecar.requests;
  assert.equal(request.authorization, `Bearer ${CLIENT_TOKEN}`);
  assert.deepEqual(request.query, {
    offset: "25",
    limit: "25",
    search: "vat",
    category: "changed",
    tool: "Bash",
    hideReadOnly: "true",
  });
  assert.equal(page.total, 1);
  assert.equal(page.results[0]._id, ROW.id);
  assert.equal(page.results[0].timestamp, "2026-10-07T14:02:00.000Z");
});

void test("filters the audit log on the period of its toolbar", async () => {
  reset();
  answer("GET", "/activity", 200, { results: [], total: 0 });
  const from = "2026-10-11T00:00:00.000Z";
  const to = "2026-10-18T09:30:00.000Z";
  await new harness.routes.AIActivityController().list(
    context(
      `offset=0&limit=25&from=${from}&to=${to}&preset=last-7-days&comparison=none`,
    ),
  );
  const [request] = sidecar.requests;
  assert.deepEqual(request.query, { offset: "0", limit: "25", from, to });
});

void test("draws the action's target under its name, in red for a destructive tool", async () => {
  reset();
  const deletion = {
    ...ROW,
    id: "c-1:call-2",
    tool: "builder_delete_resource",
    target: "orders",
  };
  const untargeted = { ...ROW, id: "c-1:call-3", target: "" };
  answer("GET", "/activity", 200, {
    results: [ROW, deletion, untargeted],
    total: 3,
  });
  const page = await new harness.routes.AIActivityController().list(
    context(""),
  );
  assert.ok(!(page instanceof HTTPResult));
  assert.deepEqual(
    page.results.map((row) => row.actionDetail),
    [{ text: "sales/overview" }, { text: "orders", tone: "error" }, null],
  );
});

void test("composes the biggest conversation's token count in the reader's language", async () => {
  reset();
  answer("GET", "/metrics/usage", 200, {
    days: [],
    totalTokens: 48210,
    conversations: 3,
    top: { conversationId: "c-1", title: "Top customers", totalTokens: 31250 },
  });
  const summary = await new harness.routes.AIMetricsController().usageSummary(
    "14",
  );
  assert.deepEqual(summary.items.at(-1).detail, {
    key: "$dms_assistant.settings.usage.top_tokens",
    params: { count: { type: "count", value: 31250 } },
  });
});

void test("sends a still-encoded activity id to the sidecar encoded once", async () => {
  reset();
  answer("GET", `/activity/${encodeURIComponent(ROW.id)}`, 200, ROW);
  await new harness.routes.AIActivityController().detail(
    encodeURIComponent(ROW.id),
  );
  const [request] = sidecar.requests;
  assert.equal(request.rawPath, `/activity/${encodeURIComponent(ROW.id)}`);
});

void test("answers 503 with a message from lists and settings while the sidecar is down", async () => {
  reset();
  sidecar.isDown = true;
  const answers = [
    await new harness.routes.AIActivityController().list(context("")),
    await new harness.routes.AIChangesController().list(context("")),
    await new harness.routes.AISettingsController().getSettings(),
    await new harness.routes.AISettingsController().updateSettings({
      thinking: "low",
    }),
  ];
  for (const result of answers) {
    assert.ok(result instanceof HTTPResult);
    assert.equal(result.getStatus(), 503);
    assert.deepEqual(bodyOf(z.json(), result), {
      message: "The assistant isn't running.",
    });
  }
});

void test("keeps the usage figures empty rather than failing while the sidecar is down", async () => {
  reset();
  sidecar.isDown = true;
  const metrics = new harness.routes.AIMetricsController();
  assert.deepEqual((await metrics.usage("14")).series[0].data, []);
  assert.deepEqual((await metrics.usageSummary("14")).items.length, 2);
});

void test("serves the settings flat, numbers as text, deletions locked on", async () => {
  reset();
  answer("GET", "/settings", 200, {
    provider: "claude",
    defaultModes: { claude: "auto", codex: "normal" },
    requestTimeoutMinutes: 5,
    checkpointRetentionDays: 30,
    providers: { codex: { available: false, reason: "No key" } },
  });
  const settings =
    await new harness.routes.AISettingsController().getSettings();
  assert.equal(settings.requestTimeoutMinutes, "5");
  assert.equal(settings.checkpointRetentionDays, "30");
  assert.equal(settings.alwaysAskDeletions, true);
  assert.equal(settings.providers.codex.available, false);
  assert.equal(settings.defaultModeClaude, "auto");
  assert.equal(settings.defaultModeCodex, "normal");
  assert.equal(settings.defaultModes, undefined);
});

void test("offers the sidecar's defaults on the settings form, numbers as text", async () => {
  reset();
  answer("GET", "/settings", 200, {
    providers: { codex: { available: false, reason: "No key" } },
    defaults: {
      provider: "claude",
      defaultModes: { claude: "auto", codex: "normal" },
      requestTimeoutMinutes: 5,
      notifyRequests: true,
    },
  });
  /** @param {string} id */
  const field = (id) => ({ id, type: "select", component: { type: "x" } });
  const options = await harness.routes.applySidecarSettings(new Set(), {
    fields: [
      field("provider"),
      field("defaultModeClaude"),
      field("defaultModeCodex"),
      {
        id: "unanswered",
        fields: [field("requestTimeoutMinutes"), field("notifyRequests")],
      },
      field("alwaysAskDeletions"),
    ],
  });
  const [provider, claudeMode, codexMode, unanswered, deletions] =
    options.fields;
  assert.ok("fields" in unanswered);
  assert.equal(provider.defaultValue, "claude");
  assert.equal(provider.offersDefault, true);
  assert.equal(claudeMode.defaultValue, "auto");
  assert.equal(codexMode.defaultValue, "normal");
  assert.equal(codexMode.offersDefault, true);
  assert.equal(unanswered.offersDefault, undefined);
  assert.deepEqual(
    unanswered.fields.map((f) => [f.defaultValue, f.offersDefault]),
    [
      ["5", true],
      [true, true],
    ],
  );
  assert.equal(deletions.offersDefault, undefined);
});

void test("serves the Safe mode switch from the stored scope, beside the scope", async () => {
  reset();
  const settings = new harness.routes.AISettingsController();
  answer("GET", "/settings", 200, { generationMode: "safe" });
  const safe = await settings.getSettings();
  answer("GET", "/settings", 200, { generationMode: "vibe" });
  const code = await settings.getSettings();
  assert.deepEqual(
    [safe.safeMode, safe.generationMode, code.safeMode, code.generationMode],
    [true, "safe", false, "vibe"],
  );
});

void test("saves the Safe mode switch as the stored scope, the switch itself never reaching the sidecar", async () => {
  reset();
  answer("PUT", "/settings", 200, {});
  const settings = new harness.routes.AISettingsController();
  await settings.updateSettings({ safeMode: false });
  await settings.updateSettings({ safeMode: true });
  await settings.updateSettings({ generationMode: "vibe" });
  await settings.updateSettings({ safeMode: "yes" });
  assert.deepEqual(
    sidecar.requests.map((request) => request.body),
    [
      { generationMode: "vibe" },
      { generationMode: "safe" },
      { generationMode: "vibe" },
      { generationMode: "yes" },
    ],
  );
});

void test("forwards no default back to the sidecar", async () => {
  reset();
  answer("PUT", "/settings", 200, {});
  await new harness.routes.AISettingsController().updateSettings({
    defaultModeClaude: "plan",
    defaultModeCodex: "acceptEdits",
    defaults: { defaultModes: { claude: "auto", codex: "normal" } },
  });
  assert.deepEqual(sidecar.requests[0].body, {
    defaultModes: { claude: "plan", codex: "acceptEdits" },
  });
});

void test("forwards one instant-saved field, and the sidecar's refusal with its message", async () => {
  reset();
  answer("PUT", "/settings", 400, { message: "codex has no auto mode" });
  const result = await new harness.routes.AISettingsController().updateSettings(
    {
      requestTimeoutMinutes: "15",
      alwaysAskDeletions: false,
      providers: {},
    },
  );
  assert.deepEqual(sidecar.requests[0].body, { requestTimeoutMinutes: 15 });
  assert.equal(result.getStatus(), 400);
  assert.deepEqual(bodyOf(z.json(), result), {
    message: "codex has no auto mode",
  });
});

void test("stamps Undo and Redo with the signed-in user", async () => {
  reset();
  answer("POST", "/changes/set-1/undo", 200, { undone: ["set-1", "set-2"] });
  answer("POST", "/changes/set-1/redo", 200, { redone: ["set-1"] });
  const changes = new harness.routes.AIChangesController();
  const undone = await changes.undo("set-1", OWNER, { includeLater: true });
  await changes.redo("set-1", { ...OWNER, name: "" });
  assert.deepEqual(undone, { undone: ["set-1", "set-2"] });
  assert.deepEqual(sidecar.requests[0].body, {
    includeLater: true,
    actor: "Camille Laurent",
  });
  assert.deepEqual(sidecar.requests[1].body, { actor: "c@acme.test" });
});

void test("forwards a change set as the sidecar wrote it, an own __proto__ key included", async () => {
  reset();
  answer(
    "GET",
    "/changes/set-1",
    200,
    JSON.parse('{"title":"Top","args":{"__proto__":{"x":1},"note":"n"}}'),
  );
  const forwarded = await new harness.routes.AIChangesController().detail(
    "set-1",
  );
  assert.equal(forwarded.title, "Top");
  assert.deepEqual(Object.getOwnPropertyNames(forwarded.args), [
    "__proto__",
    "note",
  ]);
});

void test("asks Undo's confirmation with the later change sets it collides with", async () => {
  reset();
  answer("GET", "/changes/set-1/undo-preview", 200, {
    changeSetId: "set-1",
    files: ["a.ts", "b.ts"],
    conflicts: [
      { changeSetId: "set-2", number: 14, title: "Top", files: ["a.ts"] },
    ],
  });
  const dialog = await new harness.routes.AIChangesController().undoConfirm(
    "set-1",
  );
  assert.ok(!(dialog instanceof HTTPResult));
  assert.equal(dialog.title, "$dms_assistant.changes_table.undo_confirm.title");
  assert.equal(
    dialog.description,
    "$dms_assistant.changes_table.undo_confirm.description_conflict",
  );
  assert.deepEqual(dialog.params, { count: 2, conflicts: 1 });
  assert.deepEqual(dialog.impact, [
    { icon: "i-ph-warning", label: "#14 · Top", count: 1 },
  ]);
  assert.deepEqual(
    dialog.fields.map((field) => field.id),
    ["includeLater"],
  );
});

void test("keys the change sets for the Changes table", async () => {
  reset();
  answer("GET", "/changes", 200, {
    total: 1,
    results: [
      {
        ...CHANGE_SET_BASE,
        id: "set-1",
        number: 12,
        title: "Refund chart",
        createdAtMs: 0,
        files: [{ path: "a.ts", status: "added", added: 19, removed: 0 }],
        added: 19,
        removed: 0,
        state: "undone",
        stateChangedBy: "Camille",
      },
    ],
  });
  const page = await new harness.routes.AIChangesController().list(
    context("limit=4&filter_scope=is:safe"),
  );
  assert.deepEqual(sidecar.requests[0].query, { limit: "4", scope: "safe" });
  await new harness.routes.AIChangesController().list(
    context("scope=vibe&state=applied"),
  );
  assert.deepEqual(sidecar.requests[1].query, {
    scope: "vibe",
    state: "applied",
  });
  assert.equal(page.results[0]._id, "set-1");
  assert.equal(page.results[0].diffstat, "1 · +19 −0");
  assert.equal(page.results[0].stateDetail, "Camille");
});

void test("exports the audit log as CSV, cells escaped and formulas neutralized", async () => {
  reset();
  answer("GET", "/activity/export", 200, {
    total: 1,
    results: [{ ...ROW, target: '=HYPERLINK("x")', conversationTitle: "a, b" }],
  });
  const result = await new harness.routes.AIActivityController().export(
    context("filter_category=is:failed&offset=50"),
  );
  assert.equal(result.getContentType(), "text/csv; charset=utf-8");
  assert.match(result.getHeaders()["Content-Disposition"], /attachment/);
  assert.equal(sidecar.requests[0].query.category, "failed");
  assert.equal(sidecar.requests[0].path, "/activity/export");
  const [header, line] = textOf(result).trim().split("\r\n");
  assert.ok(header.startsWith("time,tool,target,"));
  assert.ok(line.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(line.includes('"a, b"'));
});

void test("reports the assistant offline, with the process state, when it does not answer", async () => {
  reset();
  sidecar.isDown = true;
  const result = await new harness.routes.AIStatusController().status();
  const body = bodyOf(StatusSchema, result);
  assert.equal(body.status, "offline");
  assert.equal(body.isRunning, false);
  assert.equal(body.hasGivenUp, false);
});
