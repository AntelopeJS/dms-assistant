import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import {
  CLAUDE_FIXTURE,
  readClaudeTrace,
  traceInto,
} from "../helpers/provider-fixtures.js";
import {
  createCollector,
  HOST_ROOT,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION = "conv-session-options";
const WAIT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 40_000;
const SHARED_SKILL = "dms-pages";

function isTerminal(msg: WireMessage): boolean {
  return msg.type === "run_done" || msg.type === "run_error";
}

async function writeSkill(dir: string, body: string): Promise<void> {
  await mkdir(join(dir, SHARED_SKILL), { recursive: true });
  await writeFile(
    join(dir, SHARED_SKILL, "SKILL.md"),
    `---\nname: ${SHARED_SKILL}\ndescription: Pages in code.\n---\n${body}\n`,
  );
}

describe("the options a Claude session starts with", () => {
  let dir: string;
  let harness: WsHarness | undefined;
  let client: WebSocket | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-session-options-"));
  });

  afterEach(async () => {
    client?.close();
    client = undefined;
    CLAUDE_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function startedSession(
    skillDirs: { module: string; dir: string }[],
  ): Promise<ReturnType<typeof readClaudeTrace>[number] | undefined> {
    const trace = join(dir, "trace.jsonl");
    CLAUDE_FIXTURE.use("simple");
    traceInto(CLAUDE_FIXTURE.name, trace);
    harness = await startWsHarness({
      provider: CLAUDE_FIXTURE.name,
      skillDirs,
    });
    client = await openChat(harness.port);
    const collector = createCollector(client, WAIT_TIMEOUT_MS);
    sendHello(client, CONVERSATION);
    sendUserMessage(client, CONVERSATION, "go");
    await collector.next(isTerminal);
    return readClaudeTrace(trace).find((entry) => entry.kind === "session");
  }

  it(
    "starts the DMS MCP over its launcher beside the chat's own server, with the DMS MCP's navigate_to_page and preview_blocks hidden (fails a session without the DMS MCP, one that does not name the chat as its client, or one that shows two tools of one name)",
    async () => {
      const session = await startedSession([]);

      expect(session?.mcpServers).toEqual({
        dms: {
          type: "stdio",
          command: "node",
          args: [
            resolve(
              HOST_ROOT,
              "node_modules",
              ".cache",
              "dms",
              "mcp-bridge.cjs",
            ),
            "--client=chat",
          ],
        },
        "dms-assistant": { type: "sdk" },
      });
      expect(session?.disallowedTools).toEqual([
        "mcp__dms__navigate_to_page",
        "mcp__dms__preview_blocks",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "starts every session with a skill's inline shell commands, its hooks and its @ references to secret files switched off (fails a provider that leaves any of the three out; the CLI honouring them is shown on the real CLI, not here)",
    async () => {
      const session = await startedSession([]);

      expect(session?.settings?.disableSkillShellExecution).toBe(true);
      expect(session?.settings?.disableAllHooks).toBe(true);
      expect(session?.settings?.permissions?.deny).toContain(
        "Read(//**/.[eE][nN][vV])",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "names Glob and Grep in allowedTools, each scoped to the working directory, so the native CLI keeps both tools (fails a session without them, which the CLI starts with search only through Bash, or one whose rule allows a search outside the project unasked; the CLI's tool list is shown on the real CLI, not here)",
    async () => {
      const session = await startedSession([]);

      expect(session?.allowedTools).toEqual(["Glob(./**)", "Grep(./**)"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "allows only the first source's copy of a skill two sources name alike (fails a loadout that allows every catalog id)",
    async () => {
      const workflow = join(dir, "workflow");
      const moduleSkills = join(dir, "module");
      await writeSkill(workflow, "the workflow copy");
      await writeSkill(moduleSkills, "an older module copy");

      const session = await startedSession([
        { module: "antelopejs", dir: workflow },
        { module: "dms", dir: moduleSkills },
      ]);

      expect(session?.skills).toEqual([`antelopejs:${SHARED_SKILL}`]);
    },
    TEST_TIMEOUT_MS,
  );
});
