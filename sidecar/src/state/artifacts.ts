import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ArtifactRecord } from "../artifacts/types.js";
import { ARTIFACTS_LOG_PREFIX } from "../constants/artifacts.js";
import { STATE_FILE_ENCODING, STATE_JSON_INDENT } from "../constants/state.js";
import { ArtifactRecordSchema } from "./stored-schemas.js";

/** Every saved artifact, oldest first, persisted next to the transcripts. */
export interface ArtifactStore {
  load(): Promise<void>;
  all(): ArtifactRecord[];
  get(id: string): ArtifactRecord | null;
  add(record: ArtifactRecord): void;
  /** Removes the artifact; false when none has the id. */
  remove(id: string): boolean;
  flush(): Promise<void>;
}

interface StoreState {
  filePath: string;
  artifacts: ArtifactRecord[];
  /** The stored records this version cannot read, written back as they were. */
  unreadable: unknown[];
  inflight: Promise<void>;
}

/** An artifacts file as read: what this version uses, and the records it keeps aside. */
interface ReadArtifactsFile {
  artifacts: ArtifactRecord[];
  unreadable: unknown[];
}

const ArtifactsFileSchema = z.object({ artifacts: z.array(z.unknown()) });

function nothingRead(): ReadArtifactsFile {
  return { artifacts: [], unreadable: [] };
}

function parseContents(raw: string): ReadArtifactsFile {
  try {
    const parsed = ArtifactsFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return nothingRead();
    const artifacts: ArtifactRecord[] = [];
    const unreadable: unknown[] = [];
    for (const entry of parsed.data.artifacts) {
      const record = ArtifactRecordSchema.safeParse(entry);
      if (record.success) artifacts.push(record.data);
      else unreadable.push(entry);
    }
    if (unreadable.length > 0) {
      console.warn(
        `${ARTIFACTS_LOG_PREFIX} set aside ${unreadable.length} stored artifact(s) of another shape`,
      );
    }
    return { artifacts, unreadable };
  } catch {
    return nothingRead();
  }
}

async function readContents(filePath: string): Promise<ReadArtifactsFile> {
  try {
    return parseContents(await readFile(filePath, STATE_FILE_ENCODING));
  } catch {
    return nothingRead();
  }
}

/** The path of a store that keeps its artifacts in memory alone: a stack without a state directory. */
export const MEMORY_ONLY_PATH = "";

/** Queues the write behind the previous one so two quick changes land in order; a memory-only store writes nothing. */
function persist(state: StoreState): void {
  if (state.filePath === MEMORY_ONLY_PATH) return;
  const json = JSON.stringify(
    { artifacts: [...state.artifacts, ...state.unreadable] },
    null,
    STATE_JSON_INDENT,
  );
  state.inflight = state.inflight
    .then(async () => {
      await mkdir(dirname(state.filePath), { recursive: true });
      await writeFile(state.filePath, json, STATE_FILE_ENCODING);
    })
    .catch((err: unknown) => {
      console.warn(`${ARTIFACTS_LOG_PREFIX} write failed: ${String(err)}`);
    });
}

export function createArtifactStore(filePath: string): ArtifactStore {
  const state: StoreState = {
    filePath,
    ...nothingRead(),
    inflight: Promise.resolve(),
  };
  return {
    load: async () => {
      const read = await readContents(filePath);
      state.artifacts = read.artifacts;
      state.unreadable = read.unreadable;
    },
    all: () => [...state.artifacts],
    get: (id) => state.artifacts.find((record) => record.id === id) ?? null,
    add(record) {
      state.artifacts.push(record);
      persist(state);
    },
    remove(id) {
      const kept = state.artifacts.filter((record) => record.id !== id);
      if (kept.length === state.artifacts.length) return false;
      state.artifacts = kept;
      persist(state);
      return true;
    },
    flush: () => state.inflight,
  };
}
