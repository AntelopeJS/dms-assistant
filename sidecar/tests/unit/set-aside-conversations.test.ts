import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const TMP_PREFIX = "dms-assistant-set-aside-";
const STATE_FILE = "state.json";
const FILE_ENCODING = "utf8";
const SET_ASIDE_ID = "conv-full-auto";

const SET_ASIDE = {
  ownerId: "user-a",
  messages: [
    {
      role: "tool_result",
      content: "",
      toolName: "Bash",
      callId: "call-1",
      outcome: "done",
      allowedBy: "full_auto",
      timestampMs: 1,
    },
  ],
  createdAtMs: 1,
  updatedAtMs: 2,
};

describe("a conversation set aside on load", () => {
  let dir: string;
  let filePath: string;
  let conversations: ConversationStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    filePath = join(dir, STATE_FILE);
    await writeFile(
      filePath,
      JSON.stringify({ conversations: { [SET_ASIDE_ID]: SET_ASIDE } }),
      FILE_ENCODING,
    );
    conversations = createConversationStore({
      store: createStore({ filePath, debounceMs: 0 }),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps its record when another user writes under its id (fails a store that creates a conversation over it)", async () => {
    await conversations.loadFromDisk();
    conversations.claim(SET_ASIDE_ID, "user-b");
    conversations.appendMessage(SET_ASIDE_ID, {
      role: "user",
      content: "hello",
      timestampMs: 3,
    });
    conversations.setModes(SET_ASIDE_ID, { mode: "plan" });
    conversations.markProvider(SET_ASIDE_ID, "claude");
    await conversations.flush();
    const written: unknown = JSON.parse(
      await readFile(filePath, FILE_ENCODING),
    );
    expect(written).toEqual({ conversations: { [SET_ASIDE_ID]: SET_ASIDE } });
    expect(conversations.get(SET_ASIDE_ID)).toBeNull();
    expect(conversations.closure(SET_ASIDE_ID)).toBe("set_aside");
    expect(conversations.list("user-b")).toEqual([]);
  });

  it("names the ids it set aside in its warning (fails a warning that only counts them)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await conversations.loadFromDisk();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(SET_ASIDE_ID));
  });
});
