import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import {
  CLAUDE_FIXTURE,
  readClaudeTrace,
  traceInto,
} from "../helpers/provider-fixtures.js";
import {
  createCollector,
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
    dir = await mkdtemp(join(tmpdir(), "dms-ai-session-options-"));
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
