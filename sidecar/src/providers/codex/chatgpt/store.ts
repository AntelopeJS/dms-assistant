import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  APPDATA_ENV,
  CHATGPT_AUTH_FILE_NAME,
  CHATGPT_CONFIG_DIR_NAME,
  POSIX_CONFIG_DIR,
  XDG_CONFIG_HOME_ENV,
} from "../../../constants/chatgpt.js";
import { WINDOWS_PLATFORM } from "../../../constants/codex.js";
import { writePrivateFile } from "../../../state/private-file.js";

/** The tokens of a signed-in account; cleared on sign-out. */
export interface ChatGptTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** Epoch ms after which the access token is refused. */
  expiresAt: number;
  scopes: string[];
}

/**
 * What the machine remembers. The host id and the issued client id outlive a
 * sign-out: signing in again on the same host reuses both, as OpenAI requires.
 */
export interface ChatGptAuthRecord {
  /** Opaque and stable per machine; identifies the host, never the user. */
  hostId: string;
  clientId?: string;
  subject?: string;
  email?: string;
  tokens?: ChatGptTokens;
  savedAt?: string;
}

/** `%APPDATA%\dms-assistant` on Windows, `$XDG_CONFIG_HOME/dms-assistant` (or `~/.config/dms-assistant`) elsewhere. */
export function chatGptConfigDir(): string {
  const appData = process.env[APPDATA_ENV];
  if (process.platform === WINDOWS_PLATFORM && appData !== undefined) {
    return path.join(appData, CHATGPT_CONFIG_DIR_NAME);
  }
  const xdg = process.env[XDG_CONFIG_HOME_ENV];
  const base =
    xdg !== undefined && xdg !== ""
      ? xdg
      : path.join(os.homedir(), POSIX_CONFIG_DIR);
  return path.join(base, CHATGPT_CONFIG_DIR_NAME);
}

export function chatGptAuthFile(): string {
  return path.join(chatGptConfigDir(), CHATGPT_AUTH_FILE_NAME);
}

const tokensSchema = z.looseObject({
  accessToken: z.string(),
  refreshToken: z.string(),
  idToken: z.string(),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
});

const authRecordSchema = z.looseObject({
  hostId: z.string().min(1),
  clientId: z.string().optional().catch(undefined),
  subject: z.string().optional().catch(undefined),
  email: z.string().optional().catch(undefined),
  savedAt: z.string().optional().catch(undefined),
  tokens: z.unknown().optional(),
});

/**
 * The stored record, or undefined when there is none or it is unreadable.
 * Synchronous: the availability check that calls it is.
 */
export function readAuthRecord(): ChatGptAuthRecord | undefined {
  try {
    const record = authRecordSchema.safeParse(
      JSON.parse(readFileSync(chatGptAuthFile(), "utf8")),
    );
    if (!record.success) return undefined;
    return {
      ...record.data,
      tokens: tokensSchema.safeParse(record.data.tokens).data,
    };
  } catch {
    return undefined;
  }
}

/** The stored record, or a fresh one carrying a new host id. */
export function readOrCreateAuthRecord(): ChatGptAuthRecord {
  return readAuthRecord() ?? { hostId: `urn:uuid:${randomUUID()}` };
}

/**
 * Readable by the current account only, and never seen half written by a
 * reader in another sidecar: see {@link writePrivateFile}.
 */
export async function writeAuthRecord(
  record: ChatGptAuthRecord,
): Promise<void> {
  const saved: ChatGptAuthRecord = {
    ...record,
    savedAt: new Date().toISOString(),
  };
  await writePrivateFile(chatGptAuthFile(), JSON.stringify(saved, null, 2));
}

/** Whether the record holds tokens that may still work, plan scope included. */
export function isSignedIn(record: ChatGptAuthRecord | undefined): boolean {
  return record?.tokens !== undefined && record.clientId !== undefined;
}
