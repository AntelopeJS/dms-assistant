import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { WINDOWS_PLATFORM } from "../constants/codex.js";

const execFileAsync = promisify(execFile);

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SID_PATTERN = /S-1-[0-9-]+/;

let currentUserSid: Promise<string> | undefined;

async function readCurrentUserSid(): Promise<string> {
  const { stdout } = await execFileAsync(
    "whoami",
    ["/user", "/fo", "csv", "/nh"],
    { windowsHide: true },
  );
  const sid = SID_PATTERN.exec(stdout)?.[0];
  if (sid === undefined) throw new Error(`whoami reported no SID: ${stdout}`);
  return sid;
}

function lookUpCurrentUserSid(): Promise<string> {
  currentUserSid ??= readCurrentUserSid().catch((error: unknown) => {
    currentUserSid = undefined;
    throw error;
  });
  return currentUserSid;
}

/**
 * Windows ignores the POSIX mode, so the file's inherited ACL, which lets
 * SYSTEM and the Administrators group read it, is replaced by one entry for
 * the current account.
 */
async function restrictToCurrentUser(file: string): Promise<void> {
  if (process.platform !== WINDOWS_PLATFORM) {
    await chmod(file, PRIVATE_FILE_MODE);
    return;
  }
  const sid = await lookUpCurrentUserSid();
  await execFileAsync(
    "icacls",
    [file, "/inheritance:r", "/grant:r", `*${sid}:F`],
    { windowsHide: true },
  );
}

/**
 * Writes a file that holds a credential so that only the current account can
 * read it: mode 0600 in a 0700 directory, and on Windows an ACL with one entry.
 * The file is restricted while still empty, then filled, then renamed over the
 * target, so a reader never sees half a record and the secret is never
 * readable by anyone else. Rejects when the restriction cannot be applied.
 */
export async function writePrivateFile(
  file: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(file), {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, "", { mode: PRIVATE_FILE_MODE, flag: "wx" });
  await restrictToCurrentUser(temporary);
  await writeFile(temporary, contents);
  await rename(temporary, file);
}
