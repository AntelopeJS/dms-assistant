import { statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  claudeAuthFile,
  readSavedClaudeToken,
  writeSavedClaudeToken,
} from "../../src/providers/claude/credentials.js";
import {
  checkClaudeToken,
  submitClaudeToken,
  type TokenCheckFetch,
} from "../../src/providers/claude/token-check.js";

const TOKEN = "sk-ant-oat01-test-only-not-a-real-token";
const FILE_MODE_MASK = 0o777;

function answering(status: number): ReturnType<typeof vi.fn<TokenCheckFetch>> {
  return vi.fn<TokenCheckFetch>(async () => ({
    ok: status >= 200 && status < 300,
    status,
  }));
}

function failing(): ReturnType<typeof vi.fn<TokenCheckFetch>> {
  return vi.fn<TokenCheckFetch>(async () => {
    throw new TypeError("fetch failed");
  });
}

describe("checking a pasted Claude token", () => {
  it("refuses anything that is not shaped like a token without a request", async () => {
    const send = answering(200);
    for (const pasted of [
      "",
      "hunter2",
      "sk-ant",
      "sk-ant-a b",
      "sk-ant-a\nb",
    ]) {
      expect(await checkClaudeToken(pasted, send)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the token as a bearer credential to the token count endpoint", async () => {
    const send = answering(200);
    await checkClaudeToken(TOKEN, send);
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    });
  });

  it("maps 2xx to ok, 401 and 403 to rejected, the rest to unreachable", async () => {
    expect(await checkClaudeToken(TOKEN, answering(200))).toEqual({ ok: true });
    expect(await checkClaudeToken(TOKEN, answering(401))).toEqual({
      ok: false,
      reason: "rejected",
    });
    expect(await checkClaudeToken(TOKEN, answering(403))).toEqual({
      ok: false,
      reason: "rejected",
    });
    expect(await checkClaudeToken(TOKEN, answering(503))).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("maps a network error or a timeout to unreachable, not rejected", async () => {
    expect(await checkClaudeToken(TOKEN, failing())).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});

describe("submitting a pasted Claude token", () => {
  it("saves a token the check accepts, readable by its owner only", async () => {
    const result = await submitClaudeToken(`  ${TOKEN}\n`, {
      check: (token) => checkClaudeToken(token, answering(200)),
      save: writeSavedClaudeToken,
    });
    expect(result).toEqual({ ok: true });
    expect(readSavedClaudeToken()?.token).toBe(TOKEN);
    expect(statSync(claudeAuthFile()).mode & FILE_MODE_MASK).toBe(0o600);
  });

  it("never returns the token it saved", async () => {
    const result = await submitClaudeToken(TOKEN, {
      check: async () => ({ ok: true, email: "dev@example.com" }),
      save: async () => undefined,
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("saves nothing when the check rejects, is unreachable or finds it malformed", async () => {
    const save = vi.fn(async () => undefined);
    for (const reason of ["rejected", "unreachable", "malformed"] as const) {
      const result = await submitClaudeToken(TOKEN, {
        check: async () => ({ ok: false, reason }),
        save,
      });
      expect(result).toEqual({ ok: false, reason });
    }
    expect(save).not.toHaveBeenCalled();
  });
});
