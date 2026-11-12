const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");
const { waitForLock } = require("./assistant.cjs");

const ToolAnswer = z.object({
  content: z.tuple([z.object({ text: z.string() })]),
  isError: z.boolean().optional(),
});
const BuiltTools = z.array(
  z.object({
    name: z.string(),
    handler: z.function({
      input: [z.record(z.string(), z.string())],
      output: z.promise(ToolAnswer),
    }),
  }),
);
const BuiltClient = z.object({
  get: z.function({
    input: [z.string(), z.instanceof(URLSearchParams), z.string()],
    output: z.promise(z.json()),
  }),
});
const API_BASE_URL_ENV = "DMS_AI_TEST_API_BASE_URL";
const SIDECAR_DIST = path.join(__dirname, "..", "..", "..", "sidecar", "dist");

/**
 * The built sidecar's Analyst tools, reading the real backend with the
 * stand-in sidecar's token and the grant given.
 *
 * @param {string} grant
 */
async function builtAnalystTools(grant) {
  /** @param {string} file */
  const load = (file) =>
    import(pathToFileURL(path.join(SIDECAR_DIST, file)).href);
  const lock = await waitForLock();
  const tools = BuiltTools.parse(
    (await load("mcp/tools/analyst.js")).buildAnalystTools({
      analystClient: BuiltClient.parse(
        (await load("analyst/analyst-client.js")).createAnalystClient({
          backendBaseUrl: process.env[API_BASE_URL_ENV],
          token: lock.token,
        }),
      ),
      currentGrant: () => grant,
    }),
  );
  /**
   * @param {string} name
   * @param {Record<string, string>} args
   */
  return async (name, args) => {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `the built sidecar has no ${name}`);
    const answer = await tool.handler(args);
    const [content] = answer.content;
    return {
      isError: answer.isError === true,
      text: content.text,
      body: z.json().parse(JSON.parse(content.text)),
    };
  };
}

module.exports = { builtAnalystTools };
