import { describe, expect, it, vi } from "vitest";
import { expectReadableByOwnerOnly } from "../helpers/private-file.js";
import {
  claudeAuthFile,
  readSavedClaudeToken,
  writeSavedClaudeToken,
} from "../../src/providers/claude/credentials.js";
import {
  type ClaudeTokenCheck,
  type ClaudeTokenSubmitDeps,
  checkClaudeToken,
  submitClaudeToken,
  type TokenCheckFetch,
} from "../../src/providers/claude/token-check.js";

const TOKEN = "sk-ant-oat01-test-only-not-a-real-token";

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
    await expectReadableByOwnerOnly(claudeAuthFile());
  });

  it("never returns the token it saved", async () => {
    const result = await submitClaudeToken(TOKEN, {
      check: async () => ({ ok: true, email: "dev@example.com" }),
      save: async () => undefined,
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("saves the token pasted last when an older paste's check finishes after it", async () => {
    const save = vi.fn<ClaudeTokenSubmitDeps["save"]>(async () => undefined);
    let releaseFirst: () => void = () => undefined;
    const firstCheck = new Promise<ClaudeTokenCheck>((release) => {
      releaseFirst = () => release({ ok: true });
    });
    const check = (token: string): Promise<ClaudeTokenCheck> =>
      token === `${TOKEN}-first` ? firstCheck : Promise.resolve({ ok: true });
    const first = submitClaudeToken(`${TOKEN}-first`, { check, save });
    const second = submitClaudeToken(`${TOKEN}-second`, { check, save });
    await second;
    releaseFirst();
    await first;
    expect(save.mock.calls.map(([saved]) => saved.token)).toEqual([
      `${TOKEN}-second`,
    ]);
  });

  it("answers unsaved, without rejecting, when a working token cannot be written", async () => {
    const result = await submitClaudeToken(TOKEN, {
      check: async () => ({ ok: true }),
      save: async () => {
        throw new Error("EACCES");
      },
    });
    expect(result).toEqual({ ok: false, reason: "unsaved" });
  });

  it("saves a later token after an earlier one failed to save", async () => {
    const save = vi
      .fn<ClaudeTokenSubmitDeps["save"]>()
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValue(undefined);
    const deps = {
      check: async (): Promise<ClaudeTokenCheck> => ({ ok: true }),
      save,
    };
    await submitClaudeToken(`${TOKEN}-first`, deps);
    expect(await submitClaudeToken(`${TOKEN}-second`, deps)).toEqual({
      ok: true,
    });
    expect(save).toHaveBeenCalledTimes(2);
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
