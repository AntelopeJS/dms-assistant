import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  CLAUDE_CLI_ACCOUNT_FILE,
  CLAUDE_CLI_CREDENTIALS_PATH,
  DARWIN_PLATFORM,
} from "../../constants/onboarding.js";
import type { ProviderLogin } from "../login.js";
import { type ClaudeProcessEnv, hasClaudeEnvCredential } from "./config.js";
import { readSavedClaudeToken, type SavedClaudeToken } from "./credentials.js";

const cliCredentialsSchema = z.object({
  claudeAiOauth: z
    .object({
      expiresAt: z.number().optional().catch(undefined),
      refreshToken: z.string().optional().catch(undefined),
      subscriptionType: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

const cliAccountSchema = z.object({
  oauthAccount: z
    .object({ emailAddress: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

/** A file the Claude CLI left on this machine, parsed; undefined when absent or unreadable. */
type CliFile = z.infer<ReturnType<typeof z.json>> | undefined;

interface ClaudeCliFiles {
  credentials: CliFile;
  account: CliFile;
}

/** Everything the Claude login is decided from, so the decision itself reads nothing. */
export interface ClaudeLoginSources {
  env: ClaudeProcessEnv;
  saved: SavedClaudeToken | undefined;
  cli: ClaudeCliFiles;
  platform: NodeJS.Platform;
  nowMs: number;
}

function cliLogin(sources: ClaudeLoginSources): ProviderLogin {
  const oauth = cliCredentialsSchema.safeParse(sources.cli.credentials).data
    ?.claudeAiOauth;
  const account = cliAccountSchema.safeParse(sources.cli.account).data
    ?.oauthAccount;
  const email = account?.emailAddress;
  if (oauth === undefined) {
    const isKeychainLogin =
      sources.platform === DARWIN_PLATFORM && account !== undefined;
    return isKeychainLogin
      ? { status: "signed-in", source: "claude-cli", email }
      : { status: "signed-out" };
  }
  const isExpired =
    oauth.expiresAt !== undefined &&
    oauth.expiresAt <= sources.nowMs &&
    oauth.refreshToken === undefined;
  if (isExpired) return { status: "expired", source: "claude-cli", email };
  return {
    status: "signed-in",
    source: "claude-cli",
    email,
    plan: oauth.subscriptionType,
  };
}

/**
 * The login the assistant runs Claude on: the environment first, then the
 * token saved from the popup, then the Claude CLI's own login.
 */
export function detectClaudeLogin(sources: ClaudeLoginSources): ProviderLogin {
  if (hasClaudeEnvCredential(sources.env)) {
    return { status: "signed-in", source: "env" };
  }
  if (sources.saved !== undefined) {
    return {
      status: "signed-in",
      source: "saved",
      email: sources.saved.email,
      plan: sources.saved.plan,
    };
  }
  return cliLogin(sources);
}

const jsonFileSchema = z.json();

function readJson(file: string): CliFile {
  try {
    return jsonFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
}

/** The login of this machine and process right now. */
export function readClaudeLogin(): ProviderLogin {
  const home = os.homedir();
  return detectClaudeLogin({
    env: process.env,
    saved: readSavedClaudeToken(),
    cli: {
      credentials: readJson(path.join(home, ...CLAUDE_CLI_CREDENTIALS_PATH)),
      account: readJson(path.join(home, CLAUDE_CLI_ACCOUNT_FILE)),
    },
    platform: process.platform,
    nowMs: Date.now(),
  });
}
