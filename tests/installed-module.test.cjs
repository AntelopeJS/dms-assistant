const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { createRequire } = require("node:module");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");
const {
  installAsTheModuleCache,
  unresolvedImports,
} = require("./helpers/installed-module.cjs");
const {
  requestHealth,
  stopChild,
  waitForPort,
} = require("./helpers/sidecar-process.cjs");

const PreviewBlocksModuleSchema = z.object({
  buildPreviewBlocksTool: z.function({
    input: [z.unknown()],
    output: z.unknown(),
  }),
});
const SketchModuleSchema = z.object({
  sketchRefusals: z.function({
    input: [z.unknown()],
    output: z.array(z.string()),
  }),
});
const ToolSchema = z.object({
  handler: z.function({ input: [z.unknown()], output: z.unknown() }),
});
const ToolResultSchema = z.object({
  content: z.array(z.object({ text: z.string() })),
  isError: z.boolean().optional(),
});

const HOSTILE_SKETCH = { html: "<a/href=https://example.com/x>x</a>" };

/** @type {{ scratch: string; folder: string }} */
let installed;

before(async () => {
  installed = await installAsTheModuleCache();
});

after(async () => {
  await rm(installed.scratch, { recursive: true, force: true });
});

void test("every package the installed module imports is found from where it is imported", async () => {
  assert.deepEqual(
    await unresolvedImports(installed.folder, ["dist", "sidecar/dist"]),
    [],
  );
});

void test("the installed sidecar starts and serves health", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "dms-assistant-state-"));
  const child = spawn(
    process.execPath,
    [
      path.join(installed.folder, "sidecar", "dist", "index.js"),
      "--port",
      "0",
      "--root",
      stateRoot,
    ],
    { cwd: installed.folder, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const response = await requestHealth(await waitForPort(child));
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).ok, true);
  } finally {
    await stopChild(child);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

void test("the installed preview_blocks refuses a hostile sketch with the DMS sketch check's reasons", async () => {
  const sidecarDist = path.join(installed.folder, "sidecar", "dist");
  const { buildPreviewBlocksTool } = PreviewBlocksModuleSchema.parse(
    await import(
      pathToFileURL(path.join(sidecarDist, "mcp", "tools", "preview-blocks.js"))
        .href
    ),
  );
  const { sketchRefusals } = SketchModuleSchema.parse(
    createRequire(path.join(sidecarDist, "index.js"))("@antelopejs/dms/sketch"),
  );
  /** @type {unknown[]} */
  const shown = [];
  const { handler } = ToolSchema.parse(
    buildPreviewBlocksTool({
      showPreview: (/** @type {unknown} */ preview) => shown.push(preview),
      listAttachedImages: () => [],
    }),
  );
  const result = ToolResultSchema.parse(
    await handler({ title: "Hostile", sketch: HOSTILE_SKETCH }),
  );
  const refusals = sketchRefusals(HOSTILE_SKETCH);
  assert.notEqual(refusals.length, 0);
  assert.equal(result.isError, true);
  for (const refusal of refusals)
    assert.ok(result.content[0]?.text.includes(refusal), refusal);
  assert.deepEqual(shown, []);
});
