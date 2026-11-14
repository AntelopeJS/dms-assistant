import { readFile } from "node:fs/promises";
import { isDeepStrictEqual, parseEnv } from "node:util";

let watched: { file: string; loaded: object } | undefined;

async function valuesOf(file: string): Promise<object> {
  try {
    return parseEnv(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

/** Keeps the values of the project's `.env` as the run of the project that constructs the module loaded them. */
export async function rememberLoadedEnv(file: string): Promise<void> {
  watched = { file, loaded: await valuesOf(file) };
}

/**
 * Whether the values of the project's `.env` changed since this run of the project loaded them,
 * read as the core reads them. Under `ajs project dev -w` the core restarts the project on that
 * change; until then, the connections this run serves are still the ones the old values declare.
 */
export async function reloadDue(): Promise<boolean> {
  if (watched === undefined) return false;
  return !isDeepStrictEqual(await valuesOf(watched.file), watched.loaded);
}
