import fs from "node:fs";

/** A file of a fixture project by its absolute path, as bytes. */
export function fileBytes(filepath: string): Buffer {
  return fs.readFileSync(filepath);
}
