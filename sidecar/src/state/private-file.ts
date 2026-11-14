import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { WINDOWS_PLATFORM } from "../constants/codex.js";

const execFileAsync = promisify(execFile);

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SID_PATTERN = /S-1-[0-9-]+/;
const SYSTEM_ROOT_ENV = "SystemRoot";
const DEFAULT_SYSTEM_ROOT = "C:\\Windows";

/**
 * A Windows tool by its full path: a PATH lookup can find a namesake first,
 * such as the coreutils `whoami` that Git for Windows puts on PATH.
 */
function systemTool(name: string): string {
  const root = process.env[SYSTEM_ROOT_ENV] ?? DEFAULT_SYSTEM_ROOT;
  return path.win32.join(root, "System32", name);
}

let currentUserSid: Promise<string> | undefined;

async function readCurrentUserSid(): Promise<string> {
  const { stdout } = await execFileAsync(
    systemTool("whoami.exe"),
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
 * The ACL file `icacls /restore` reads: in UTF-16LE, each file's name relative
 * to the directory, then its security descriptor in SDDL. `D:P` is a protected
 * DACL, which inherits nothing; its one entry grants the account full access.
 */
function ownerOnlyAclFile(file: string, sid: string): Buffer {
  const descriptor = `D:P(A;;FA;;;${sid})`;
  return Buffer.from(`${path.basename(file)}\r\n${descriptor}\r\n`, "utf16le");
}

/**
 * Windows ignores the POSIX mode, and a new file gets entries for SYSTEM and
 * the Administrators group, inherited or from the creator's token, so its
 * whole DACL is replaced by one entry for the current account.
 */
async function restrictToCurrentUser(file: string): Promise<void> {
  if (process.platform !== WINDOWS_PLATFORM) {
    await chmod(file, PRIVATE_FILE_MODE);
    return;
  }
  const sid = await lookUpCurrentUserSid();
  const aclFile = `${file}.acl`;
  await writeFile(aclFile, ownerOnlyAclFile(file, sid), { flag: "wx" });
  try {
    await execFileAsync(
      systemTool("icacls.exe"),
      [path.dirname(file), "/restore", aclFile],
      { windowsHide: true },
    );
  } finally {
    await rm(aclFile, { force: true });
  }
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
