import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  SAVED_PROMPT_ERRORS,
  SAVED_PROMPT_NAME_MAX_LENGTH,
  SAVED_PROMPT_TEXT_MAX_LENGTH,
  SAVED_PROMPTS_LOG_PREFIX,
  type SavedPromptErrorCode,
} from "../constants/saved-prompts.js";
import { STATE_FILE_ENCODING, STATE_JSON_INDENT } from "../constants/state.js";

/**
 * A prompt a member saved under a name, to run again. It belongs to the
 * `userId` that saved it, as a conversation belongs to its `ownerId`: nobody
 * else lists, edits, runs or deletes it.
 */
export interface SavedPrompt {
  id: string;
  ownerId: string;
  name: string;
  text: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SavedPromptInput {
  ownerId: string;
  name: string;
  text: string;
}

export type SavedPromptPatch = Partial<Pick<SavedPrompt, "name" | "text">>;

/** A write the store refused; `code` says why. */
export class SavedPromptError extends Error {
  constructor(
    readonly code: SavedPromptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SavedPromptError";
  }
}

export interface SavedPromptStore {
  load(): Promise<void>;
  /** The owner's prompts, by name. */
  listFor(ownerId: string): SavedPrompt[];
  /**
   * The owner's prompt under `id`, or null when there is none or it is
   * another owner's: a foreign id reads as unknown, so the answer tells
   * nothing about other members' prompts.
   */
  getFor(id: string, ownerId: string): SavedPrompt | null;
  /** Throws `SavedPromptError` on a duplicate name or an invalid record. */
  create(input: SavedPromptInput, nowMs?: number): SavedPrompt;
  /** Null when `id` is not the owner's; throws like `create`. */
  update(
    id: string,
    ownerId: string,
    patch: SavedPromptPatch,
    nowMs?: number,
  ): SavedPrompt | null;
  /** False when `id` is not the owner's. */
  remove(id: string, ownerId: string): boolean;
  flush(): Promise<void>;
}

/** A saved prompt as `saved-prompts.json` holds it; keys it does not name are kept. */
export const SavedPromptSchema: z.ZodType<SavedPrompt> = z.looseObject({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().trim().min(1).max(SAVED_PROMPT_NAME_MAX_LENGTH),
  text: z.string().trim().min(1).max(SAVED_PROMPT_TEXT_MAX_LENGTH),
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
});

const SavedPromptsFileSchema = z.object({ prompts: z.array(z.unknown()) });

interface StoreState {
  filePath: string;
  prompts: SavedPrompt[];
  /** The stored records this version cannot read, written back as they were. */
  unreadable: unknown[];
  inflight: Promise<void>;
}

interface ReadSavedPromptsFile {
  prompts: SavedPrompt[];
  unreadable: unknown[];
}

const WHITESPACE_RUN = /\s+/g;

/** What two names must differ in to be two names: case and spacing do not count. */
function nameKey(name: string): string {
  return name.trim().replaceAll(WHITESPACE_RUN, " ").toLowerCase();
}

function byName(left: SavedPrompt, right: SavedPrompt): number {
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });
}

function parseContents(raw: string): ReadSavedPromptsFile {
  try {
    const parsed = SavedPromptsFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { prompts: [], unreadable: [] };
    const prompts: SavedPrompt[] = [];
    const unreadable: unknown[] = [];
    for (const entry of parsed.data.prompts) {
      const prompt = SavedPromptSchema.safeParse(entry);
      if (prompt.success) prompts.push(prompt.data);
      else unreadable.push(entry);
    }
    if (unreadable.length > 0) {
      console.warn(
        `${SAVED_PROMPTS_LOG_PREFIX} set aside ${unreadable.length} stored prompt(s) of another shape`,
      );
    }
    return { prompts, unreadable };
  } catch {
    return { prompts: [], unreadable: [] };
  }
}

async function readContents(filePath: string): Promise<ReadSavedPromptsFile> {
  try {
    return parseContents(await readFile(filePath, STATE_FILE_ENCODING));
  } catch (err) {
    const isMissing =
      err instanceof Error && "code" in err && err.code === "ENOENT";
    if (!isMissing) {
      console.warn(`${SAVED_PROMPTS_LOG_PREFIX} read failed: ${String(err)}`);
    }
    return { prompts: [], unreadable: [] };
  }
}

/** Queues the write behind the previous one so two quick changes land in order. */
function persist(state: StoreState): void {
  const json = JSON.stringify(
    { prompts: [...state.prompts, ...state.unreadable] },
    null,
    STATE_JSON_INDENT,
  );
  state.inflight = state.inflight
    .then(async () => {
      await mkdir(dirname(state.filePath), { recursive: true });
      await writeFile(state.filePath, json, STATE_FILE_ENCODING);
    })
    .catch((err: unknown) => {
      console.warn(`${SAVED_PROMPTS_LOG_PREFIX} write failed: ${String(err)}`);
    });
}

function ownedBy(
  state: StoreState,
  id: string,
  ownerId: string,
): SavedPrompt | undefined {
  return state.prompts.find(
    (prompt) => prompt.id === id && prompt.ownerId === ownerId,
  );
}

/** Throws when another prompt of the owner already carries `name`. */
function assertNameFree(
  state: StoreState,
  ownerId: string,
  name: string,
  exceptId?: string,
): void {
  const key = nameKey(name);
  const taken = state.prompts.some(
    (prompt) =>
      prompt.ownerId === ownerId &&
      prompt.id !== exceptId &&
      nameKey(prompt.name) === key,
  );
  if (taken) {
    throw new SavedPromptError(
      SAVED_PROMPT_ERRORS.DUPLICATE_NAME,
      `A saved prompt is already named "${name.trim()}".`,
    );
  }
}

/** The record as the file will hold it, or a refusal naming the first problem. */
function validRecord(candidate: SavedPrompt): SavedPrompt {
  const parsed = SavedPromptSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  throw new SavedPromptError(
    SAVED_PROMPT_ERRORS.INVALID,
    parsed.error.issues[0]?.message ?? "Invalid saved prompt.",
  );
}

function create(
  state: StoreState,
  input: SavedPromptInput,
  nowMs: number,
): SavedPrompt {
  const record = validRecord({
    id: randomUUID(),
    ownerId: input.ownerId,
    name: input.name,
    text: input.text,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  });
  assertNameFree(state, record.ownerId, record.name);
  state.prompts.push(record);
  persist(state);
  return record;
}

function update(
  state: StoreState,
  id: string,
  ownerId: string,
  patch: SavedPromptPatch,
  nowMs: number,
): SavedPrompt | null {
  const current = ownedBy(state, id, ownerId);
  if (current === undefined) return null;
  const next = validRecord({
    ...current,
    name: patch.name ?? current.name,
    text: patch.text ?? current.text,
    updatedAtMs: nowMs,
  });
  assertNameFree(state, ownerId, next.name, id);
  Object.assign(current, next);
  persist(state);
  return current;
}

function remove(state: StoreState, id: string, ownerId: string): boolean {
  const current = ownedBy(state, id, ownerId);
  if (current === undefined) return false;
  state.prompts = state.prompts.filter((prompt) => prompt !== current);
  persist(state);
  return true;
}

export function createSavedPromptStore(filePath: string): SavedPromptStore {
  const state: StoreState = {
    filePath,
    prompts: [],
    unreadable: [],
    inflight: Promise.resolve(),
  };
  return {
    load: async () => {
      const read = await readContents(filePath);
      state.prompts = read.prompts;
      state.unreadable = read.unreadable;
    },
    listFor: (ownerId) =>
      state.prompts.filter((prompt) => prompt.ownerId === ownerId).sort(byName),
    getFor: (id, ownerId) => ownedBy(state, id, ownerId) ?? null,
    create: (input, nowMs = Date.now()) => create(state, input, nowMs),
    update: (id, ownerId, patch, nowMs = Date.now()) =>
      update(state, id, ownerId, patch, nowMs),
    remove: (id, ownerId) => remove(state, id, ownerId),
    flush: () => state.inflight,
  };
}
