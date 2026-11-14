import { DEFAULT_CLAUDE_MODEL } from "./settings.js";

/**
 * Per user, not per project, like the ChatGPT store: one sign-in serves every
 * DMS project on the machine.
 */
export const ASSISTANT_CONFIG_DIR_NAME = "dms-assistant";
export const CLAUDE_AUTH_FILE_NAME = "claude-auth.json";

/** The variables that carry a Claude credential, strongest first. */
export const CLAUDE_CREDENTIAL_ENV_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

/** The variable a saved token is handed to the CLI through. */
export const CLAUDE_OAUTH_TOKEN_ENV_VAR = CLAUDE_CREDENTIAL_ENV_VARS[0];

export const CLAUDE_TOKEN_PATTERN = /^sk-ant-[A-Za-z0-9_-]+$/;

export const CLAUDE_TOKEN_CHECK_URL =
  "https://api.anthropic.com/v1/messages/count_tokens";
export const CLAUDE_TOKEN_CHECK_MODEL = DEFAULT_CLAUDE_MODEL;
export const CLAUDE_TOKEN_CHECK_TIMEOUT_MS = 10_000;
export const CLAUDE_TOKEN_CHECK_HEADERS = {
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "oauth-2025-04-20",
} as const;

/**
 * Where the Claude CLI keeps its own login. `CLAUDE_CONFIG_DIR` moves both files into that
 * directory; without it the credentials sit in `~/.claude` and the account file in `~`.
 */
export const CLAUDE_CONFIG_DIR_ENV_VAR = "CLAUDE_CONFIG_DIR";
export const CLAUDE_CLI_DEFAULT_DIR = ".claude";
export const CLAUDE_CLI_CREDENTIALS_FILE = ".credentials.json";
export const CLAUDE_CLI_ACCOUNT_FILE = ".claude.json";
export const DARWIN_PLATFORM = "darwin";
