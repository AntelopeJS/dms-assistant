import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { writeAuthRecord } from "../../src/providers/codex/chatgpt/store.js";
import { createHttpServer } from "../../src/server/http.js";
import { createConversationStore } from "../../src/state/conversations.js";
import {
  createSettingsStore,
  type SettingsStore,
} from "../../src/state/settings-store.js";
import { createStore } from "../../src/state/store.js";
import { signedInRecord, signInForTests } from "../helpers/chatgpt-auth.js";

const CLIENT_TOKEN = "onboarding-route-credential";
const realFetch = globalThis.fetch;

interface Running {
  base: string;
  settingsStore: SettingsStore;
  close: () => Promise<void>;
}

async function start(): Promise<Running> {
  const directory = await mkdtemp(join(tmpdir(), "dms-assistant-onboarding-"));
  const conversationStore = createConversationStore({
    store: createStore({ filePath: join(directory, "state.json") }),
  });
  const settingsStore = createSettingsStore({
    filePath: join(directory, "settings.json"),
  });
  const { server, port } = await createHttpServer({
    clientToken: CLIENT_TOKEN,
    port: 0,
    conversationStore,
    settingsStore,
    settingsApplier: { apply: (next) => settingsStore.set(next) },
  });
  return {
    base: `http://127.0.0.1:${port}`,
    settingsStore,
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const StateSchema = z.looseObject({
  bootId: z.string(),
  provider: z.string(),
  logins: z.looseObject({
    claude: z.looseObject({ status: z.string() }),
    codex: z.looseObject({ status: z.string() }),
  }),
});

function call(running: Running, path: string, body?: Record<string, string>) {
  return realFetch(`${running.base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${CLIENT_TOKEN}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("the onboarding routes", () => {
  let running: Running;
  beforeEach(async () => {
    running = await start();
  });
  afterEach(() => running.close());

  it("refuses a caller without the client credential", async () => {
    for (const path of [
      "/onboarding",
      "/onboarding/claude-token",
      "/onboarding/provider",
    ]) {
      const response = await realFetch(`${running.base}${path}`);
      expect(response.status).toBe(401);
    }
  });

  it("answers the provider, both logins and one boot id that stays the same", async () => {
    const first = StateSchema.parse(
      await (await call(running, "/onboarding")).json(),
    );
    const second = StateSchema.parse(
      await (await call(running, "/onboarding")).json(),
    );
    expect(first).toMatchObject({
      provider: "claude",
      logins: { codex: { status: "signed-in", source: "chatgpt" } },
    });
    expect(["signed-in", "signed-out", "expired"]).toContain(
      first.logins.claude.status,
    );
    expect(first).not.toHaveProperty("codexLoginUrl");
    expect(first.bootId.length).toBeGreaterThan(0);
    expect(second.bootId).toBe(first.bootId);
  });

  it("offers one ChatGPT sign-in attempt across the popup's polling, and a new one after a sign-in", async () => {
    const { tokens: _tokens, ...signedOut } = signedInRecord();
    await writeAuthRecord(signedOut);
    try {
      const urls = [];
      for (let read = 0; read < 3; read += 1) {
        const state = z
          .looseObject({ codexLoginUrl: z.string() })
          .parse(await (await call(running, "/onboarding")).json());
        urls.push(new URL(state.codexLoginUrl).searchParams.get("state"));
      }
      expect(urls[0]).toBeTruthy();
      expect(new Set(urls).size).toBe(1);

      await signInForTests();
      await call(running, "/onboarding");
      await writeAuthRecord(signedOut);
      const after = z
        .looseObject({ codexLoginUrl: z.string() })
        .parse(await (await call(running, "/onboarding")).json());
      expect(new URL(after.codexLoginUrl).searchParams.get("state")).not.toBe(
        urls[0],
      );
    } finally {
      await signInForTests();
    }
  });

  it("sets the provider setting and answers the new state", async () => {
    const response = await call(running, "/onboarding/provider", {
      provider: "codex",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: "codex" });
    expect(running.settingsStore.get().provider).toBe("codex");
  });

  it("refuses an unknown provider and keeps the setting", async () => {
    const response = await call(running, "/onboarding/provider", {
      provider: "gemini",
    });
    expect(response.status).toBe(400);
    expect(running.settingsStore.get().provider).toBe("claude");
  });

  it("answers a malformed token without a request and without echoing it", async () => {
    const pasted = "not-a-claude-token";
    const response = await call(running, "/onboarding/claude-token", {
      token: pasted,
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: false, reason: "malformed" });
    expect(text).not.toContain(pasted);
  });

  it("answers 200 unsaved when the token works but this machine cannot save it", async () => {
    const home = await mkdtemp(join(tmpdir(), "dms-assistant-unsaved-"));
    const configHome = join(home, "xdg");
    await writeFile(configHome, "a file where the config directory should go");
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 })),
    );
    const response = await call(running, "/onboarding/claude-token", {
      token: "sk-ant-oat01-route-test-only",
    });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, reason: "unsaved" });
  });

  it("refuses a token body without a token", async () => {
    const response = await call(running, "/onboarding/claude-token", {});
    expect(response.status).toBe(400);
  });
});
