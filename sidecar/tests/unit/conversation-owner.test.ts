import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConversationStore } from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const STATE_FILE = "state.json";
const FAST_DEBOUNCE_MS = 10;
const OWNED = "conv-owned";
const LEGACY = "conv-legacy";

function openStore(dir: string) {
  return createConversationStore({
    store: createStore({
      filePath: join(dir, STATE_FILE),
      debounceMs: FAST_DEBOUNCE_MS,
    }),
  });
}

describe("a conversation's owner in the stored state", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-assistant-owner-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("survives a reload and is not replaced by a later claim (fails an owner that is not stored, or is overwritten)", async () => {
    const first = openStore(dir);
    await first.loadFromDisk();
    first.claim(OWNED, "u-camille");
    first.claim(OWNED, "u-dana");
    await first.flush();
    const second = openStore(dir);
    await second.loadFromDisk();
    expect(second.get(OWNED)?.ownerId).toBe("u-camille");
  });

  it("loads a state file written before owners existed, and lists it to everyone (fails a schema that requires ownerId)", async () => {
    const stored = {
      conversations: {
        [LEGACY]: {
          messages: [{ role: "user", content: "old", timestampMs: 1 }],
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      },
    };
    await writeFile(join(dir, STATE_FILE), JSON.stringify(stored), "utf8");
    const store = openStore(dir);
    await store.loadFromDisk();
    expect(store.get(LEGACY)?.ownerId).toBeUndefined();
    expect(store.list("u-camille").map((c) => c.id)).toEqual([LEGACY]);
    expect(store.list(null).map((c) => c.id)).toEqual([LEGACY]);
  });
});
