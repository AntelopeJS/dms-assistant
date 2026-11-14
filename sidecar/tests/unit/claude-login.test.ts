import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ClaudeLoginSources,
  detectClaudeLogin,
  readClaudeLogin,
} from "../../src/providers/claude/login.js";

const NOW_MS = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

const SAVED = {
  token: "sk-ant-oat01-saved-test",
  email: "saved@example.com",
  plan: "pro",
  savedAt: "2026-01-01T00:00:00.000Z",
};

const CLI_FILES = {
  credentials: {
    claudeAiOauth: {
      accessToken: "cli-access-test",
      refreshToken: "cli-refresh-test",
      expiresAt: NOW_MS + HOUR_MS,
      subscriptionType: "max",
    },
  },
  account: { oauthAccount: { emailAddress: "cli@example.com" } },
};

function sources(
  overrides: Partial<ClaudeLoginSources> = {},
): ClaudeLoginSources {
  return {
    env: {},
    saved: undefined,
    cli: { credentials: undefined, account: undefined },
    platform: "linux",
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe("the Claude login the assistant runs on", () => {
  it("prefers the environment over a saved token and the CLI login", () => {
    const login = detectClaudeLogin(
      sources({
        env: { ANTHROPIC_API_KEY: "sk-ant-api03-env-test" },
        saved: SAVED,
        cli: CLI_FILES,
      }),
    );
    expect(login).toEqual({ status: "signed-in", source: "env" });
  });

  it("counts each of the three credential variables, and not an empty one", () => {
    for (const name of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
    ]) {
      const login = detectClaudeLogin(sources({ env: { [name]: "value" } }));
      expect(login).toMatchObject({ status: "signed-in", source: "env" });
    }
    const empty = detectClaudeLogin(
      sources({ env: { ANTHROPIC_API_KEY: "" } }),
    );
    expect(empty).toEqual({ status: "signed-out" });
  });

  it("prefers a saved token over the CLI login", () => {
    const login = detectClaudeLogin(sources({ saved: SAVED, cli: CLI_FILES }));
    expect(login).toEqual({
      status: "signed-in",
      source: "saved",
      email: "saved@example.com",
      plan: "pro",
    });
  });

  it("falls back to the CLI login with its account email and plan", () => {
    const login = detectClaudeLogin(sources({ cli: CLI_FILES }));
    expect(login).toEqual({
      status: "signed-in",
      source: "claude-cli",
      email: "cli@example.com",
      plan: "max",
    });
  });

  it("is signed out when nothing holds a login", () => {
    expect(detectClaudeLogin(sources())).toEqual({ status: "signed-out" });
  });

  it("reports a CLI login past its expiry with no refresh token as expired", () => {
    const login = detectClaudeLogin(
      sources({
        cli: {
          ...CLI_FILES,
          credentials: {
            claudeAiOauth: { expiresAt: NOW_MS - HOUR_MS },
          },
        },
      }),
    );
    expect(login).toEqual({
      status: "expired",
      source: "claude-cli",
      email: "cli@example.com",
    });
  });

  it("keeps a CLI login past its expiry signed in when it can refresh", () => {
    const login = detectClaudeLogin(
      sources({
        cli: {
          ...CLI_FILES,
          credentials: {
            claudeAiOauth: {
              expiresAt: NOW_MS - HOUR_MS,
              refreshToken: "cli-refresh-test",
            },
          },
        },
      }),
    );
    expect(login).toMatchObject({ status: "signed-in", source: "claude-cli" });
  });

  it("reads the macOS keychain login from the account file alone, and only on macOS", () => {
    const cli = { credentials: undefined, account: CLI_FILES.account };
    expect(detectClaudeLogin(sources({ cli, platform: "darwin" }))).toEqual({
      status: "signed-in",
      source: "claude-cli",
      email: "cli@example.com",
    });
    expect(detectClaudeLogin(sources({ cli, platform: "linux" }))).toEqual({
      status: "signed-out",
    });
  });
});

function writeCliLogin(
  accountDirectory: string,
  email: string,
  credentialsDirectory: string,
): void {
  mkdirSync(credentialsDirectory, { recursive: true });
  writeFileSync(
    path.join(credentialsDirectory, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "cli-access-test",
        refreshToken: "cli-refresh-test",
        expiresAt: Date.now() + HOUR_MS,
        subscriptionType: "max",
      },
    }),
  );
  writeFileSync(
    path.join(accountDirectory, ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: email } }),
  );
}

describe("where the Claude CLI's own login is read", () => {
  afterEach(() => vi.unstubAllEnvs());

  function isolatedEnvironment() {
    for (const name of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CONFIG_DIR",
    ]) {
      vi.stubEnv(name, "");
    }
    const home = mkdtempSync(path.join(tmpdir(), "claude-login-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("XDG_CONFIG_HOME", path.join(home, "xdg"));
    vi.stubEnv("APPDATA", path.join(home, "xdg"));
    return {
      home,
      configDir: mkdtempSync(path.join(tmpdir(), "claude-login-config-")),
    };
  }

  it("reads the credentials and the account file from CLAUDE_CONFIG_DIR when it is set", () => {
    const { home, configDir } = isolatedEnvironment();
    writeCliLogin(configDir, "configured@example.com", configDir);
    writeCliLogin(home, "home@example.com", path.join(home, ".claude"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    expect(readClaudeLogin()).toEqual({
      status: "signed-in",
      source: "claude-cli",
      email: "configured@example.com",
      plan: "max",
    });
  });

  it("is signed out when CLAUDE_CONFIG_DIR holds no login, whatever the home directory holds", () => {
    const { home, configDir } = isolatedEnvironment();
    writeCliLogin(home, "home@example.com", path.join(home, ".claude"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    expect(readClaudeLogin()).toEqual({ status: "signed-out" });
  });

  it("reads ~/.claude/.credentials.json and ~/.claude.json without it, an empty value counting as unset", () => {
    const { home } = isolatedEnvironment();
    writeCliLogin(home, "home@example.com", path.join(home, ".claude"));
    expect(readClaudeLogin()).toMatchObject({
      status: "signed-in",
      source: "claude-cli",
      email: "home@example.com",
    });
  });
});
