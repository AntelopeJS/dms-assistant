import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSession } from "../../src/agent/provider.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import { createCodexProvider } from "../../src/providers/codex/provider.js";
import type {
  GenerationMode,
  TurnSettings,
} from "../../src/state/settings-types.js";
import {
  CODEX_FIXTURE,
  codexTurns,
  readCodexTrace,
  traceCodexInto,
} from "../helpers/provider-fixtures.js";
import { buildInertMcpDeps } from "../helpers/provider-runner.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

const TEST_TIMEOUT_MS = 30_000;
const CONVERSATION = "conv-dms-access";
const SIMPLE_DUMP = "recette-1-simple-message.jsonl";
const WATCHED_METHODS = [
  "config/batchWrite",
  "config/mcpServer/reload",
  "thread/start",
  "turn/start",
];

function settingsIn(generationMode: GenerationMode): TurnSettings {
  return { ...TURN_SETTINGS, generationMode };
}

async function drainTurn(
  session: ProviderSession,
  settings: TurnSettings,
): Promise<void> {
  for await (const _event of session.runTurn(
    { text: "hello", attachments: [] },
    settings,
  )) {
  }
}

describe("the access of a Codex chat's DMS MCP", () => {
  let dir: string;
  let trace: string;
  let registry: McpHttpRegistry | undefined;
  let session: ProviderSession | undefined;

  async function openSession(settings: TurnSettings): Promise<ProviderSession> {
    registry = createMcpHttpRegistry();
    const provider = createCodexProvider({
      settings,
      stateDir: join(dir, ".state"),
      mcpHttpRegistry: registry,
      createMcpDeps: buildInertMcpDeps,
      getMcpUrl: () => "http://127.0.0.1:1/mcp",
    });
    session = await provider.createSession({
      conversationId: CONVERSATION,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      settings,
      onDisposed: () => {},
    });
    return session;
  }

  /** The watched requests in order, with the access a batch write gives. */
  function requests(): string[] {
    return readCodexTrace(trace)
      .filter((entry) => WATCHED_METHODS.includes(entry.method ?? ""))
      .map((entry) =>
        entry.method === "config/batchWrite"
          ? `${entry.method} ${JSON.stringify(entry.params?.edits)}`
          : (entry.method ?? ""),
      );
  }

  function accessWrite(access: string): string {
    const args = [
      join(dir, "node_modules", ".cache", "dms", "mcp-bridge.cjs"),
      "--client=chat",
      `--access=${access}`,
    ];
    return `config/batchWrite ${JSON.stringify([
      {
        keyPath: "mcp_servers.dms.args",
        mergeStrategy: "replace",
        value: args,
      },
    ])}`;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-dms-access-"));
    trace = join(dir, "trace.jsonl");
    setBuilderAvailable(true);
    CODEX_FIXTURE.use("simple");
    traceCodexInto(trace);
    process.env.MOCK_CODEX_SCRIPT = codexTurns(
      SIMPLE_DUMP,
      SIMPLE_DUMP,
      SIMPLE_DUMP,
    );
  });

  afterEach(async () => {
    await session?.dispose();
    session = undefined;
    await registry?.dispose();
    registry = undefined;
    CODEX_FIXTURE.reset();
    setBuilderAvailable(false);
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "restarts the DMS MCP with the new access before the first turn after a flip between Safe and Code, on the same thread (fails a Code chat left on Safe access, or a Safe chat left on full access)",
    async () => {
      const opened = await openSession(settingsIn("safe"));
      await drainTurn(opened, settingsIn("safe"));
      await drainTurn(opened, settingsIn("vibe"));
      await drainTurn(opened, settingsIn("safe"));

      expect(requests()).toEqual([
        "thread/start",
        "turn/start",
        accessWrite("full"),
        "config/mcpServer/reload",
        "turn/start",
        accessWrite("safe"),
        "config/mcpServer/reload",
        "turn/start",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves the DMS MCP alone while the chat stays in its mode (fails a reload on every turn)",
    async () => {
      const opened = await openSession(settingsIn("safe"));
      await drainTurn(opened, settingsIn("safe"));
      await drainTurn(opened, settingsIn("safe"));

      expect(requests()).toEqual(["thread/start", "turn/start", "turn/start"]);
    },
    TEST_TIMEOUT_MS,
  );
});
