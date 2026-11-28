import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAVED_PROMPT_ERRORS } from "../../src/constants/saved-prompts.js";
import {
  createSavedPromptStore,
  SavedPromptError,
  type SavedPrompt,
  type SavedPromptStore,
} from "../../src/state/saved-prompts.js";

const TMP_PREFIX = "dms-assistant-saved-prompts-";
const FILE_ENCODING = "utf8";
const CAMILLE = "user-camille";
const LOUIS = "user-louis";
const NOW_MS = 1_700_000_000_000;
const LATER_MS = NOW_MS + 60_000;

const STORED: SavedPrompt = {
  id: "p-1",
  ownerId: CAMILLE,
  name: "Weekly revenue",
  text: "Summarise last week's revenue per region.",
  createdAtMs: NOW_MS,
  updatedAtMs: NOW_MS,
};

/** The code of the refusal `run` throws, or undefined when it runs through. */
function errorCode(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    return err instanceof SavedPromptError ? err.code : undefined;
  }
}

let dir: string;
let filePath: string;
let opened: SavedPromptStore[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  filePath = join(dir, "saved-prompts.json");
  opened = [];
});

afterEach(async () => {
  await Promise.all(opened.map((store) => store.flush()));
  await rm(dir, { recursive: true, force: true });
});

/** A store on the test's file, loaded, and flushed before the file goes. */
async function open(): Promise<SavedPromptStore> {
  const store = createSavedPromptStore(filePath);
  await store.load();
  opened.push(store);
  return store;
}

describe("who sees and edits a saved prompt", () => {
  it("lists each member their own prompts by name, and nobody else's (fails a store that lists every prompt)", async () => {
    const store = await open();
    store.create({ ownerId: CAMILLE, name: "zebra", text: "z" }, NOW_MS);
    store.create({ ownerId: CAMILLE, name: "Apple", text: "a" }, NOW_MS);
    store.create({ ownerId: LOUIS, name: "Mine", text: "m" }, NOW_MS);
    expect(store.listFor(CAMILLE).map((prompt) => prompt.name)).toEqual([
      "Apple",
      "zebra",
    ]);
    expect(store.listFor(LOUIS).map((prompt) => prompt.name)).toEqual(["Mine"]);
    expect(store.listFor("user-nobody")).toEqual([]);
  });

  it("reads a foreign prompt as unknown on get, update and remove (fails a store that lets a member touch another's prompt)", async () => {
    const store = await open();
    const mine = store.create(
      { ownerId: CAMILLE, name: "Mine", text: "m" },
      NOW_MS,
    );
    expect(store.getFor(mine.id, LOUIS)).toBeNull();
    expect(
      store.update(mine.id, LOUIS, { name: "Taken" }, LATER_MS),
    ).toBeNull();
    expect(store.remove(mine.id, LOUIS)).toBe(false);
    expect(store.getFor(mine.id, CAMILLE)).toEqual(mine);
  });

  it("refuses a second prompt of the same name for one member, whatever its case or spacing, and allows it for another member", async () => {
    const store = await open();
    store.create(
      { ownerId: CAMILLE, name: "Weekly  revenue", text: "a" },
      NOW_MS,
    );
    expect(
      errorCode(() =>
        store.create(
          { ownerId: CAMILLE, name: " weekly revenue ", text: "b" },
          NOW_MS,
        ),
      ),
    ).toBe(SAVED_PROMPT_ERRORS.DUPLICATE_NAME);
    expect(
      store.create(
        { ownerId: LOUIS, name: "Weekly revenue", text: "c" },
        NOW_MS,
      ).name,
    ).toBe("Weekly revenue");
  });

  it("renames a prompt onto a free name, trims it, stamps the update time, and refuses a taken name (fails an update that lets two prompts share a name)", async () => {
    const store = await open();
    const first = store.create(
      { ownerId: CAMILLE, name: "First", text: "1" },
      NOW_MS,
    );
    store.create({ ownerId: CAMILLE, name: "Second", text: "2" }, NOW_MS);
    const renamed = store.update(
      first.id,
      CAMILLE,
      { name: "  Renamed  ", text: " new text " },
      LATER_MS,
    );
    expect(renamed).toMatchObject({
      id: first.id,
      name: "Renamed",
      text: "new text",
      createdAtMs: NOW_MS,
      updatedAtMs: LATER_MS,
    });
    expect(
      errorCode(() =>
        store.update(first.id, CAMILLE, { name: "second" }, LATER_MS),
      ),
    ).toBe(SAVED_PROMPT_ERRORS.DUPLICATE_NAME);
    expect(store.getFor(first.id, CAMILLE)?.name).toBe("Renamed");
  });

  it("refuses an empty name, an empty text and a text over the cap without storing anything", async () => {
    const store = await open();
    const refused = [
      { ownerId: CAMILLE, name: "   ", text: "a" },
      { ownerId: CAMILLE, name: "Empty", text: "  " },
      { ownerId: CAMILLE, name: "Long", text: "x".repeat(20_001) },
      { ownerId: CAMILLE, name: "n".repeat(81), text: "a" },
    ];
    for (const input of refused) {
      expect(errorCode(() => store.create(input, NOW_MS))).toBe(
        SAVED_PROMPT_ERRORS.INVALID,
      );
    }
    expect(store.listFor(CAMILLE)).toEqual([]);
  });
});

describe("the saved prompts file", () => {
  it("writes what it holds and reads it back after a restart, a removed prompt gone (fails a store that keeps prompts in memory only)", async () => {
    const store = await open();
    const kept = store.create(
      { ownerId: CAMILLE, name: "Kept", text: "k" },
      NOW_MS,
    );
    const gone = store.create(
      { ownerId: CAMILLE, name: "Gone", text: "g" },
      NOW_MS,
    );
    expect(store.remove(gone.id, CAMILLE)).toBe(true);
    await store.flush();
    const reopened = await open();
    expect(reopened.listFor(CAMILLE)).toEqual([kept]);
  });

  it("sets aside a stored record of another shape and writes it back as it was", async () => {
    const unreadable = { id: "p-2", ownerId: CAMILLE, name: "No text" };
    await writeFile(
      filePath,
      JSON.stringify({ prompts: [STORED, unreadable] }),
      FILE_ENCODING,
    );
    const store = await open();
    expect(store.listFor(CAMILLE)).toEqual([STORED]);
    store.update(STORED.id, CAMILLE, { text: "Edited" }, LATER_MS);
    await store.flush();
    expect(JSON.parse(await readFile(filePath, FILE_ENCODING))).toEqual({
      prompts: [
        { ...STORED, text: "Edited", updatedAtMs: LATER_MS },
        unreadable,
      ],
    });
  });

  it("starts empty on a missing file and on a file that is not a prompts file", async () => {
    const missing = await open();
    expect(missing.listFor(CAMILLE)).toEqual([]);
    await writeFile(filePath, "not json", FILE_ENCODING);
    const broken = await open();
    expect(broken.listFor(CAMILLE)).toEqual([]);
  });
});
