import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const TMP_PREFIX = "dms-assistant-retired-roles-";
const STATE_FILE = "state.json";
const FILE_ENCODING = "utf8";
const CONVERSATION_ID = "conv-with-block-preview";
const OWNER_ID = "user-a";

const USER_MESSAGE = { role: "user", content: "Show me a KPI", timestampMs: 1 };
const ASSISTANT_MESSAGE = {
  role: "assistant",
  content: "Here it is.",
  timestampMs: 3,
};

const STORED = {
  ownerId: OWNER_ID,
  messages: [
    USER_MESSAGE,
    {
      role: "block_preview",
      content: "",
      preview: {
        id: "preview-1",
        title: "Revenue KPI",
        tree: { type: "KpiCard", options: { label: "Revenue" } },
        timestampMs: 2,
      },
      timestampMs: 2,
    },
    ASSISTANT_MESSAGE,
  ],
  createdAtMs: 1,
  updatedAtMs: 3,
};

describe("a stored conversation holding a block preview of an earlier version", () => {
  let dir: string;
  let conversations: ConversationStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    const filePath = join(dir, STATE_FILE);
    await writeFile(
      filePath,
      JSON.stringify({ conversations: { [CONVERSATION_ID]: STORED } }),
      FILE_ENCODING,
    );
    conversations = createConversationStore({
      store: createStore({ filePath, debounceMs: 0 }),
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads with its other messages and without the preview (fails a store that sets the conversation aside or keeps the preview)", async () => {
    await conversations.loadFromDisk();
    expect(conversations.get(CONVERSATION_ID)?.messages).toEqual([
      USER_MESSAGE,
      ASSISTANT_MESSAGE,
    ]);
  });
});
