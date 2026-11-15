export const SECRET_FILE_NAME = ".env";
export const SECRET_FILE_NAME_PREFIX = ".env.";

/** A secret file name that a pattern reaching `.env.*` matches when its literal start does not. */
export const SECRET_FILE_SAMPLE_NAME = ".env.local";

/** The search tools, mapped to the input that holds their file-name glob. */
export const SEARCH_TOOL_GLOB_KEYS: ReadonlyMap<string, "glob" | "pattern"> =
  new Map([
    ["Grep", "glob"],
    ["Glob", "pattern"],
  ]);

export const SECRET_FILE_TEMPLATE_NAMES: ReadonlySet<string> = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

export const AGENT_REQUIRED_ENV_NAMES: ReadonlySet<string> = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "PATH",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
]);

export const SECRET_FILE_DENIED_MESSAGE =
  "Values in .env are kept from the assistant, so it may not read or change this file. Use the variable names from the project configuration, or from .env.example when there is one, and ask the user for the values.";
