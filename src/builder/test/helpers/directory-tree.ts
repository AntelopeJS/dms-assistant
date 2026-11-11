import fs from "node:fs";

/** Every file and directory under a directory, relative to it and sorted. */
export function directoryTree(directory: string): string[] {
  return fs
    .readdirSync(directory, { recursive: true, encoding: "utf8" })
    .sort();
}
