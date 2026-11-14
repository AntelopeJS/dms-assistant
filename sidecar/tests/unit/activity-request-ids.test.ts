import { describe, expect, it } from "vitest";
import type { PendingRequest } from "../../src/agent/permission-bus.js";
import { buildActivityRecords } from "../../src/audit/activity.js";
import type { ConversationEntry } from "../../src/state/conversations.js";

const NOW = Date.UTC(2026, 10, 14, 12);
const REQUEST_ID = "4f1c2b9e-request-that-answers";
const CONVERSATION_ID = "c-codex";

const PENDING: PendingRequest = {
  conversationId: CONVERSATION_ID,
  requestId: REQUEST_ID,
  toolName: "Bash",
  args: { command: "pnpm add dayjs" },
  summary: "Run pnpm add dayjs",
  kind: "command",
  alwaysAsk: false,
  preview: { type: "command", command: "pnpm add dayjs", cwd: "/srv/app" },
  ruleOptions: [],
  createdAtMs: NOW,
  expiresAtMs: NOW + 60_000,
};

const ENTRY: ConversationEntry = {
  id: CONVERSATION_ID,
  title: "Add a dependency",
  conversation: {
    createdAtMs: NOW,
    updatedAtMs: NOW,
    provider: "codex",
    messages: [
      {
        role: "permission",
        content: "",
        toolName: "Bash",
        requestId: REQUEST_ID,
        args: PENDING.args,
        requestedAtMs: NOW,
        timestampMs: NOW,
      },
    ],
  },
};

describe("a pending request with no call id in Activity", () => {
  it("is listed once under an id that is not its request id (fails a feed that exposes the id that answers it)", () => {
    const records = buildActivityRecords({
      entries: [ENTRY],
      changeSets: [],
      pending: [PENDING],
      running: new Set(),
      hostProjectRoot: "/srv/app",
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toMatch(/^c-codex:request-[0-9a-f]{16}$/);
    expect(JSON.stringify(records.map((record) => record.id))).not.toContain(
      REQUEST_ID,
    );
  });
});
