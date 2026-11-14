import { readFile } from "node:fs/promises";

let watched: { file: string; loaded: string | undefined } | undefined;

async function textOf(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Keeps the text of the project's `.env` as the run of the project that constructs the module loaded it. */
export async function rememberLoadedEnv(file: string): Promise<void> {
  watched = { file, loaded: await textOf(file) };
}

/**
 * Whether the project's `.env` changed since this run of the project loaded it. Under
 * `ajs project dev -w` the core restarts the project on that change; until then, the connections
 * this run serves are still the ones the old `.env` declares.
 */
export async function reloadDue(): Promise<boolean> {
  if (watched === undefined) return false;
  return (await textOf(watched.file)) !== watched.loaded;
}
