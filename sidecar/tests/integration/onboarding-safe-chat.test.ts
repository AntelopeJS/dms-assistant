import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import {
  type ScriptedCall,
  writeClaudeScript,
} from "../helpers/claude-scripts.js";
import {
  CLAUDE_FIXTURE,
  readClaudeTrace,
  traceInto,
} from "../helpers/provider-fixtures.js";
import {
  collectUntil,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-onboarding-safe";
const RUN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

/**
 * The calls the onboarding's "Generate a first mockup" turn makes once the
 * popup has written and analysed the connection itself: the reads its prompt
 * names, then the mockup it drafts.
 */
const ONBOARDING_CALLS: ScriptedCall[] = [
  "database_describe",
  "database_relations",
  "database_profile",
  "mockup_write_spec",
].map((tool, index) => ({
  id: `onboarding-${index}`,
  name: `mcp__dms__${tool}`,
  input: { connection: "erp", module: "erp-tables" },
}));

let harness: WsHarness | undefined;
let dir: string | undefined;

afterEach(async () => {
  CLAUDE_FIXTURE.reset();
  setBuilderAvailable(false);
  await harness?.close();
  harness = undefined;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function runSafeTurn(trace: string): Promise<WireMessage[]> {
  if (dir === undefined) throw new Error("no scratch directory");
  setBuilderAvailable(true);
  CLAUDE_FIXTURE.use("plain");
  process.env.MOCK_CLAUDE_SCRIPT = await writeClaudeScript(
    dir,
    "onboarding",
    ONBOARDING_CALLS,
  );
  traceInto("claude", trace);
  harness = await startWsHarness({
    provider: "claude",
    settings: { generationMode: "safe" },
  });
  const client = await openChat(harness.port);
  const collected = collectUntil(client, {
    timeoutMs: RUN_TIMEOUT_MS,
    until: (msg) => msg.type === "run_done" || msg.type === "run_error",
  });
  sendHello(client, CONVERSATION_ID);
  sendUserMessage(client, CONVERSATION_ID, "draft a first mockup of erp");
  const events = await collected;
  client.close();
  return events;
}

describe("the onboarding's database mockup turn in a Safe chat", () => {
  it(
    "runs every DMS read and mockup call unasked, on a DMS MCP started with Safe access (fails a Safe chat that blocks the onboarding's turn, or one whose DMS MCP could change the project)",
    async () => {
      dir = await mkdtemp(join(tmpdir(), "dms-assistant-onboarding-safe-"));
      const trace = join(dir, "trace.jsonl");

      const events = await runSafeTurn(trace);

      const entries = readClaudeTrace(trace);
      expect(
        events
          .map((msg) => msg.type)
          .filter((type) => type === "run_done" || type === "run_error"),
      ).toEqual(["run_done"]);
      expect(events.filter((msg) => msg.type === "permission_request")).toEqual(
        [],
      );
      expect(
        entries
          .filter((entry) => entry.kind === "tool")
          .map((entry) => [entry.name, entry.isAllowed]),
      ).toEqual(ONBOARDING_CALLS.map((call) => [call.name, true]));
      expect(
        entries.find((entry) => entry.kind === "session")?.mcpServers?.dms
          ?.args,
      ).toContain("--access=safe");
    },
    TEST_TIMEOUT_MS,
  );
});
