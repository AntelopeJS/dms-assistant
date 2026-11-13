import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  APPDATA_ENV,
  POSIX_CONFIG_DIR,
  XDG_CONFIG_HOME_ENV,
} from "../../constants/chatgpt.js";
import { WINDOWS_PLATFORM } from "../../constants/codex.js";
import {
  ASSISTANT_AUTH_FILE_MODE,
  ASSISTANT_CONFIG_DIR_MODE,
  ASSISTANT_CONFIG_DIR_NAME,
  CLAUDE_AUTH_FILE_NAME,
} from "../../constants/onboarding.js";

/** The Claude token a developer pasted into the onboarding popup. */
export interface SavedClaudeToken {
  token: string;
  email?: string;
  plan?: string;
  savedAt: string;
}

/** `%APPDATA%\dms-assistant` on Windows, `$XDG_CONFIG_HOME/dms-assistant` (or `~/.config/dms-assistant`) elsewhere. */
export function assistantConfigDir(): string {
  const appData = process.env[APPDATA_ENV];
  if (process.platform === WINDOWS_PLATFORM && appData !== undefined) {
    return path.join(appData, ASSISTANT_CONFIG_DIR_NAME);
  }
  const xdg = process.env[XDG_CONFIG_HOME_ENV];
  const base =
    xdg !== undefined && xdg !== ""
      ? xdg
      : path.join(os.homedir(), POSIX_CONFIG_DIR);
  return path.join(base, ASSISTANT_CONFIG_DIR_NAME);
}

export function claudeAuthFile(): string {
  return path.join(assistantConfigDir(), CLAUDE_AUTH_FILE_NAME);
}

const savedTokenSchema = z.looseObject({
  token: z.string().min(1),
  email: z.string().optional().catch(undefined),
  plan: z.string().optional().catch(undefined),
  savedAt: z.string().catch(""),
});

/**
 * The saved token, or undefined when there is none or the file is unreadable.
 * Synchronous: the environment the agent starts with is built synchronously.
 */
export function readSavedClaudeToken(): SavedClaudeToken | undefined {
  try {
    const record = savedTokenSchema.safeParse(
      JSON.parse(readFileSync(claudeAuthFile(), "utf8")),
    );
    if (!record.success) return undefined;
    const { token, email, plan, savedAt } = record.data;
    return { token, email, plan, savedAt };
  } catch {
    return undefined;
  }
}

/**
 * Written to a sibling then renamed over the file, so a reader never sees half
 * a record, and created 0600 in a 0700 directory. The mode is applied again
 * with chmod because the `mode` option is masked by the umask and the token
 * must not be.
 */
export async function writeSavedClaudeToken(
  saved: Omit<SavedClaudeToken, "savedAt">,
): Promise<void> {
  const file = claudeAuthFile();
  await mkdir(path.dirname(file), {
    recursive: true,
    mode: ASSISTANT_CONFIG_DIR_MODE,
  });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const record: SavedClaudeToken = {
    ...saved,
    savedAt: new Date().toISOString(),
  };
  await writeFile(temporary, JSON.stringify(record, null, 2), {
    mode: ASSISTANT_AUTH_FILE_MODE,
  });
  await chmod(temporary, ASSISTANT_AUTH_FILE_MODE);
  await rename(temporary, file);
}

export async function clearSavedClaudeToken(): Promise<void> {
  await rm(claudeAuthFile(), { force: true });
}
