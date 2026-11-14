import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const FILE_MODE_MASK = 0o777;
const OWNER_ONLY_MODE = 0o600;
const ACL_FILE_ENV = "DMS_TEST_ACL_FILE";

const READ_ACL = `
$acl = Get-Acl -LiteralPath $env:${ACL_FILE_ENV}
$rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
[pscustomobject]@{
  currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  isProtected = $acl.AreAccessRulesProtected
  rules = @($rules | ForEach-Object {
    [pscustomobject]@{
      sid = $_.IdentityReference.Value
      type = "$($_.AccessControlType)"
      isInherited = $_.IsInherited
    }
  })
} | ConvertTo-Json -Compress -Depth 4
`;

const ruleSchema = z.object({
  sid: z.string(),
  type: z.string(),
  isInherited: z.boolean(),
});

const aclSchema = z.object({
  currentUser: z.string(),
  isProtected: z.boolean(),
  rules: z.array(ruleSchema),
});

async function readWindowsAcl(
  file: string,
): Promise<z.infer<typeof aclSchema>> {
  const { stdout } = await execFileAsync(
    path.win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    ["-NoProfile", "-NonInteractive", "-Command", READ_ACL],
    { env: { ...process.env, [ACL_FILE_ENV]: file }, windowsHide: true },
  );
  return aclSchema.parse(JSON.parse(stdout));
}

/**
 * Asserts that only the current account can read `file`: mode 0600 on POSIX,
 * and on Windows, which ignores the mode, an ACL that inherits nothing and
 * holds one entry, for the current user.
 */
export async function expectReadableByOwnerOnly(file: string): Promise<void> {
  if (process.platform !== "win32") {
    expect((await stat(file)).mode & FILE_MODE_MASK).toBe(OWNER_ONLY_MODE);
    return;
  }
  const acl = await readWindowsAcl(file);
  expect(acl.isProtected).toBe(true);
  expect(acl.rules).toEqual([
    { sid: acl.currentUser, type: "Allow", isInherited: false },
  ]);
}
