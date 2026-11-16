import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const TMP_PREFIX = "dms-assistant-formal-deletion-";
const CONVERSATION = "conv-deleted";
const CAMILLE = "u-camille";
const DANA = "u-dana";
const NOBODY_HOLDS_IT = {
  stored: null,
  listedForCamille: [],
  listedForDana: [],
};
const MESSAGE = { role: "user", content: "hi", timestampMs: 1 } as const;

/**
 * The counterexamples TLC finds in `.agents/skills/formal-conversation-deletion`
 * for the code before #59 and before #60, replayed step by step against the
 * real conversation store: each step is the store call the model's action
 * stands for, and the rule is the model's `DeletedStaysDeleted`.
 */
describe("a deleted conversation (formal target: deleted conversations staying closed)", () => {
  let dir: string;

  const open = (): ConversationStore =>
    createConversationStore({
      store: createStore({ filePath: join(dir, "state.json"), debounceMs: 0 }),
    });

  const viewsOf = (store: ConversationStore) => ({
    stored: store.get(CONVERSATION),
    listedForCamille: store.list(CAMILLE),
    listedForDana: store.list(DANA),
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is not written back by the turn that ran through the delete: Admit, Begin, Delete, TurnWrite (fails a delete that does not close the id)", async () => {
    const store = open();
    await store.loadFromDisk();
    store.claim(CONVERSATION, CAMILLE);
    store.delete(CONVERSATION);
    store.appendMessage(CONVERSATION, MESSAGE);
    store.claim(CONVERSATION, DANA);
    expect(viewsOf(store)).toEqual(NOBODY_HOLDS_IT);
  });

  it("is not claimed or listed after a restart: Admit, Delete, Restart, Admit (fails closed ids kept only in memory)", async () => {
    const first = open();
    await first.loadFromDisk();
    first.claim(CONVERSATION, CAMILLE);
    first.appendMessage(CONVERSATION, MESSAGE);
    first.delete(CONVERSATION);
    await first.flush();
    const second = open();
    await second.loadFromDisk();
    second.claim(CONVERSATION, DANA);
    second.appendMessage(CONVERSATION, MESSAGE);
    expect(viewsOf(second)).toEqual(NOBODY_HOLDS_IT);
  });
});
