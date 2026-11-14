import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  APPDATA_ENV,
  XDG_CONFIG_HOME_ENV,
} from "../../src/constants/chatgpt.js";
import {
  type ChatGptAuthRecord,
  writeAuthRecord,
} from "../../src/providers/codex/chatgpt/store.js";

const HOUR_MS = 3_600_000;

/** A record whose token stays fresh for the whole run: no refresh is attempted. */
export function signedInRecord(): ChatGptAuthRecord {
  return {
    hostId: "urn:uuid:00000000-0000-4000-8000-000000000000",
    clientId: "oaiapp_test",
    subject: "user-test",
    email: "dev@example.com",
    tokens: {
      accessToken: "chatgpt-access-mock",
      refreshToken: "chatgpt-refresh-mock",
      idToken: "chatgpt-id-mock",
      expiresAt: Date.now() + 24 * HOUR_MS,
      scopes: ["openid", "chatgpt.tokens.use.direct"],
    },
  };
}

const CONFIG_HOME_ENVS = [XDG_CONFIG_HOME_ENV, APPDATA_ENV] as const;

/**
 * Points the per-user config home, `XDG_CONFIG_HOME` and Windows' `APPDATA`
 * alike, at a fresh temporary directory, so no test reads or writes the
 * developer's real sign-ins. Returns its removal.
 */
export function useTemporaryConfigHome(): () => void {
  const saved = CONFIG_HOME_ENVS.map((name) => ({
    name,
    value: process.env[name],
  }));
  const home = mkdtempSync(path.join(tmpdir(), "dms-ai-config-"));
  for (const name of CONFIG_HOME_ENVS) process.env[name] = home;
  return () => {
    for (const { name, value } of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  };
}

export function signInForTests(): Promise<void> {
  return writeAuthRecord(signedInRecord());
}
