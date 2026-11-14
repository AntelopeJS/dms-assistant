import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETED_ID_RETENTION_MS } from "../../src/constants/state.js";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const TMP_PREFIX = "dms-assistant-deleted-";
const STATE_FILE = "state.json";
const FILE_ENCODING = "utf8";
const DELETED_ID = "conv-deleted";
const NEVER_STORED_ID = "conv-never-stored";

describe("a deleted conversation's id", () => {
  let dir: string;
  let filePath: string;

  function openStore(): ConversationStore {
    return createConversationStore({
      store: createStore({ filePath, debounceMs: 0 }),
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    filePath = join(dir, STATE_FILE);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stays closed after a restart, so another person cannot claim it (fails a deletion kept only in memory)", async () => {
    const first = openStore();
    await first.loadFromDisk();
    first.claim(DELETED_ID, "u-camille");
    first.appendMessage(DELETED_ID, {
      role: "user",
      content: "hi",
      timestampMs: 1,
    });
    first.delete(DELETED_ID);
    await first.flush();
    const second = openStore();
    await second.loadFromDisk();
    expect(second.closure(DELETED_ID)).toBe("deleted");
    second.claim(DELETED_ID, "u-dana");
    expect(second.get(DELETED_ID)).toBeNull();
  });

  it("records nothing for an id the store never held (fails a delete that grows the table with any id)", async () => {
    const store = openStore();
    await store.loadFromDisk();
    store.claim("conv-kept", "u-camille");
    store.delete(NEVER_STORED_ID);
    await store.flush();
    expect(store.closure(NEVER_STORED_ID)).toBeNull();
    const written: unknown = JSON.parse(
      await readFile(filePath, FILE_ENCODING),
    );
    expect(written).not.toHaveProperty("deleted");
  });

  it("is forgotten once older than the retention (fails a table that grows without limit)", async () => {
    const now = Date.now();
    await writeFile(
      filePath,
      JSON.stringify({
        conversations: {},
        deleted: {
          "conv-old": now - DELETED_ID_RETENTION_MS - 1,
          "conv-recent": now - 1,
        },
      }),
      FILE_ENCODING,
    );
    const store = openStore();
    await store.loadFromDisk();
    expect(store.closure("conv-old")).toBeNull();
    expect(store.closure("conv-recent")).toBe("deleted");
  });
});
