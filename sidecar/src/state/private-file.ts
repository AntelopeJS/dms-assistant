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
const POWERSHELL_TIMEOUT_MS = 30_000;

const SET_OWNER_ONLY_DACL = [
  "$ErrorActionPreference = 'Stop'",
  "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
  "$acl = [System.Security.AccessControl.FileSecurity]::new()",
  "$acl.SetAccessRuleProtection($true, $false)",
  "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'Allow'))",
  `[System.IO.File]::SetAccessControl($env:${TARGET_ENV}, $acl)`,
].join("; ");

const SET_OWNER_ONLY_DIRECTORY_DACL = [
  "$ErrorActionPreference = 'Stop'",
  "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
  "$acl = [System.Security.AccessControl.DirectorySecurity]::new()",
  "$acl.SetAccessRuleProtection($true, $false)",
  "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))",
  `[System.IO.Directory]::SetAccessControl($env:${TARGET_ENV}, $acl)`,
].join("; ");

/**
 * Runs one of the scripts above on `target` through Windows PowerShell, called
 * by its System32 path, with the path in the environment, never in the command
 * text. The scripts call .NET only, no cmdlet, so a module path inherited from
 * PowerShell 7 cannot break them. A run past the timeout is killed and
 * rejects, so a hung PowerShell cannot stall a write.
 */
async function runDaclScript(script: string, target: string): Promise<void> {
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
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, [TARGET_ENV]: target },
      timeout: POWERSHELL_TIMEOUT_MS,
      windowsHide: true,
    },
  );
}

/**
 * Restricts a file to the current user. POSIX gets mode `0o600`. Windows
 * ignores modes, so there the file's DACL is replaced with a protected one
 * whose only entry grants the process token's user full control. That drops
 * the inherited entries and the explicit ones the process's default DACL
 * gives a new file, needs no privilege beyond owning the file, and parses no
 * output.
 */
async function restrictToOwner(file: string): Promise<void> {
  await chmod(file, PRIVATE_FILE_MODE);
  if (process.platform !== WINDOWS_PLATFORM) return;
  await runDaclScript(SET_OWNER_ONLY_DACL, file);
}

const privateDirectories = new Set<string>();

/**
 * On Windows, gives the directory a protected DACL whose only entry, inherited
 * by what is created in it, grants the current user full control, so a file is
 * born owner-only and no other account can open it before its own DACL is
 * set. Done once per directory and process; every caller writes into a
 * directory that holds only this sidecar's private state.
 */
async function restrictDirectoryToOwner(directory: string): Promise<void> {
  if (process.platform !== WINDOWS_PLATFORM) return;
  if (privateDirectories.has(directory)) return;
  await runDaclScript(SET_OWNER_ONLY_DIRECTORY_DACL, directory);
  privateDirectories.add(directory);
}

/**
 * Writes a file that holds a credential so that only the current account can
 * open it. On POSIX the file is created 0600, in a directory created 0700. On
 * Windows the directory is made owner-only first, so the file is born
 * owner-only, and the file then gets its own protected DACL. Only then is the
 * secret written, and the file renamed over the target, so a reader never
 * sees half a record. Rejects when a restriction cannot be applied, leaving
 * no temporary file and the target as it was.
 */
export async function writePrivateFile(
  file: string,
  contents: string,
): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await restrictDirectoryToOwner(directory);
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
