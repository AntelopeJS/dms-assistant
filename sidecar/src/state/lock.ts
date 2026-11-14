import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SIDECAR_LOCK_FILE_NAME } from "../constants/daemon.js";
import { STATE_DIR_SEGMENTS } from "../constants/paths.js";
import { writePrivateFile } from "./private-file.js";

export interface SidecarLock {
  port: number;
  pid: number;
  version: string;
  buildId: string;
  startedAt: number;
  token: string;
  clientToken: string;
}

export function buildLockPath(root: string): string {
  return join(root, ...STATE_DIR_SEGMENTS, SIDECAR_LOCK_FILE_NAME);
}

/** Holds the sidecar's tokens, so only the current account can read it. */
export async function writeLock(
  root: string,
  lock: SidecarLock,
): Promise<void> {
  await writePrivateFile(buildLockPath(root), JSON.stringify(lock));
}

const LockPidSchema = z.object({
  pid: z.number().optional().catch(undefined),
});

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const parsed = LockPidSchema.parse(
      JSON.parse(await readFile(lockPath, "utf8")),
    );
    return parsed.pid ?? null;
  } catch {
    return null;
  }
}

/**
 * Removes the lock only when this process owns it, so a retired/orphaned instance
 * can't delete the live sidecar's lock and cause the backend to spawn a duplicate.
 */
export async function removeLock(
  root: string,
  ownerPid: number = process.pid,
): Promise<void> {
  const lockPath = buildLockPath(root);
  const pid = await readLockPid(lockPath);
  if (pid !== null && pid !== ownerPid) return;
  await rm(lockPath).catch(() => undefined);
}
