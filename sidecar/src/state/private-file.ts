import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { WINDOWS_PLATFORM } from "../constants/codex.js";

const execFileAsync = promisify(execFile);

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const TARGET_ENV = "DMS_OWNER_ONLY_FILE";

const SET_OWNER_ONLY_DACL = [
  "$ErrorActionPreference = 'Stop'",
  "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
  "$acl = [System.Security.AccessControl.FileSecurity]::new()",
  "$acl.SetAccessRuleProtection($true, $false)",
  "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'Allow'))",
  `[System.IO.File]::SetAccessControl($env:${TARGET_ENV}, $acl)`,
].join("; ");

/**
 * Restricts a file to the current user. POSIX gets mode `0o600`. Windows
 * ignores modes, so there Windows PowerShell replaces the file's DACL with a
 * protected one whose only entry grants the process token's user full
 * control. That drops the inherited entries and the explicit ones the
 * process's default DACL gives a new file, needs no privilege beyond owning
 * the file, and parses no output. PowerShell is called by its System32 path
 * and gets the file path through the environment, never in its command text.
 * The script calls .NET only, no cmdlet, so a module path inherited from
 * PowerShell 7 cannot break it.
 */
async function restrictToOwner(file: string): Promise<void> {
  await chmod(file, PRIVATE_FILE_MODE);
  if (process.platform !== WINDOWS_PLATFORM) return;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const powershell = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  await execFileAsync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", SET_OWNER_ONLY_DACL],
    { env: { ...process.env, [TARGET_ENV]: file }, windowsHide: true },
  );
}

/**
 * Writes a file that holds a credential so that only the current account can
 * read it: mode 0600 in a 0700 directory, and on Windows a protected DACL with
 * one entry. The file is restricted while still empty, then filled, then
 * renamed over the target, so a reader never sees half a record and the
 * secret is never readable by anyone else. Rejects, leaving no file behind,
 * when the restriction cannot be applied.
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
  try {
    await writeFile(temporary, "", { mode: PRIVATE_FILE_MODE, flag: "wx" });
    await restrictToOwner(temporary);
    await writeFile(temporary, contents);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
