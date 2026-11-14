import { randomUUID } from "node:crypto";

let current = randomUUID();

/** Names the project run that constructs the module: every start or restart of the project gets a new name. */
export function beginRun(): void {
  current = randomUUID();
}

/**
 * The name of the project run that answers. A URL written into `.env` loads only in a later run,
 * so the popup takes no answer from the run that answered before its write.
 */
export function projectRun(): string {
  return current;
}
