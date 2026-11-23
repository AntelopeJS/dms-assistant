import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import "./home/page";
import "./board/page";

export * from "./order";
import { PLAYGROUND_SCHEMA } from "./schema";

export async function construct(): Promise<void> {}

/**
 * Provisions the builder demo's tables and runs their fixtures, so the source
 * editor's preview has rows to read. Runs after the DMS start(), by which
 * point the database adapter is available.
 */
export async function start(): Promise<void> {
  await RegisterSchema(PLAYGROUND_SCHEMA);
}

export function destroy(): void {}

export function stop(): void {}
