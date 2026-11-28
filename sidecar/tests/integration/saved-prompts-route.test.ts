import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createHttpServer } from "../../src/server/http.js";
import { createConversationStore } from "../../src/state/conversations.js";
import {
  createSavedPromptStore,
  type SavedPromptStore,
} from "../../src/state/saved-prompts.js";
import { createSettingsStore } from "../../src/state/settings-store.js";
import { createStore } from "../../src/state/store.js";

const CLIENT_TOKEN = "saved-prompts-route-credential";
const CAMILLE = "user-camille";
const LOUIS = "user-louis";

const PromptSchema = z.looseObject({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  text: z.string(),
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
});
const PageSchema = z.object({
  results: z.array(PromptSchema),
  total: z.number(),
});
const RefusalSchema = z.looseObject({
  message: z.string(),
  code: z.string().optional(),
});

interface Running {
  base: string;
  store?: SavedPromptStore;
  close: () => Promise<void>;
}

/** What a test sends: a prompt's fields, or a body that is not an object. */
type RequestBody = Record<string, string> | string;

async function start(withStore = true): Promise<Running> {
  const directory = await mkdtemp(join(tmpdir(), "dms-assistant-prompts-"));
  const conversationStore = createConversationStore({
    store: createStore({ filePath: join(directory, "state.json") }),
  });
  const settingsStore = createSettingsStore({
    filePath: join(directory, "settings.json"),
  });
  const store = withStore
    ? createSavedPromptStore(join(directory, "saved-prompts.json"))
    : undefined;
  await store?.load();
  const { server, port } = await createHttpServer({
    clientToken: CLIENT_TOKEN,
    port: 0,
    conversationStore,
    settingsStore,
    settingsApplier: { apply: (next) => settingsStore.set(next) },
    savedPromptStore: store,
  });
  return {
    base: `http://127.0.0.1:${port}`,
    store,
    close: async () => {
      await store?.flush();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function call(
  running: Running,
  method: string,
  path: string,
  body?: RequestBody,
  token = CLIENT_TOKEN,
) {
  return fetch(`${running.base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createPrompt(running: Running, owner: string, name: string) {
  const res = await call(running, "POST", "/prompts", {
    owner,
    name,
    text: `Text of ${name}`,
  });
  expect(res.status).toBe(200);
  return PromptSchema.parse(await res.json());
}

describe("the saved-prompt routes", () => {
  let running: Running;
  beforeEach(async () => {
    running = await start();
  });
  afterEach(() => running.close());

  it("refuses a caller without the client credential, on every method", async () => {
    for (const [method, path, body] of [
      ["GET", "/prompts?owner=u", undefined],
      ["POST", "/prompts", {}],
      ["PUT", "/prompts/p-1", {}],
      ["DELETE", "/prompts/p-1?owner=u", undefined],
    ] as const) {
      const res = await call(running, method, path, body, "wrong");
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("saves a prompt for its owner, lists it to that owner alone, and answers a list without an owner 400 (fails a list that leaks another member's prompts)", async () => {
    const saved = await createPrompt(running, CAMILLE, "Weekly revenue");
    expect(saved).toMatchObject({
      ownerId: CAMILLE,
      name: "Weekly revenue",
      text: "Text of Weekly revenue",
    });
    const own = PageSchema.parse(
      await (await call(running, "GET", `/prompts?owner=${CAMILLE}`)).json(),
    );
    expect(own).toEqual({ results: [saved], total: 1 });
    const foreign = PageSchema.parse(
      await (await call(running, "GET", `/prompts?owner=${LOUIS}`)).json(),
    );
    expect(foreign).toEqual({ results: [], total: 0 });
    expect((await call(running, "GET", "/prompts")).status).toBe(400);
  });

  it("refuses a body without an owner, an empty name, a blank text or a text over the cap with 400, storing nothing", async () => {
    const bodies: RequestBody[] = [
      { name: "No owner", text: "t" },
      { owner: CAMILLE, name: "", text: "t" },
      { owner: CAMILLE, name: "Blank", text: "   " },
      { owner: CAMILLE, name: "Long", text: "x".repeat(20_001) },
      { owner: CAMILLE, name: "n".repeat(81), text: "t" },
      "not an object",
    ];
    for (const body of bodies) {
      const res = await call(running, "POST", "/prompts", body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(RefusalSchema.parse(await res.json()).message).not.toBe("");
    }
    expect(running.store?.listFor(CAMILLE)).toEqual([]);
  });

  it("answers 409 with its code when the owner already has a prompt of that name, and lets another member use it", async () => {
    await createPrompt(running, CAMILLE, "Weekly revenue");
    const twice = await call(running, "POST", "/prompts", {
      owner: CAMILLE,
      name: "weekly revenue",
      text: "again",
    });
    expect(twice.status).toBe(409);
    expect(RefusalSchema.parse(await twice.json())).toMatchObject({
      code: "duplicate_name",
    });
    await createPrompt(running, LOUIS, "Weekly revenue");
  });

  it("edits and deletes a prompt for its owner, and answers 404 to another member as to an unknown id (fails a route that edits or deletes across members)", async () => {
    const saved = await createPrompt(running, CAMILLE, "Draft");
    const stolen = await call(running, "PUT", `/prompts/${saved.id}`, {
      owner: LOUIS,
      name: "Stolen",
    });
    expect(stolen.status).toBe(404);
    const removedByOther = await call(
      running,
      "DELETE",
      `/prompts/${saved.id}?owner=${LOUIS}`,
    );
    expect(removedByOther.status).toBe(404);
    const edited = await call(running, "PUT", `/prompts/${saved.id}`, {
      owner: CAMILLE,
      text: "Edited text",
    });
    expect(edited.status).toBe(200);
    expect(PromptSchema.parse(await edited.json())).toMatchObject({
      id: saved.id,
      name: "Draft",
      text: "Edited text",
    });
    const unknown = await call(running, "PUT", "/prompts/nope", {
      owner: CAMILLE,
      name: "x",
    });
    expect(unknown.status).toBe(404);
    const removed = await call(
      running,
      "DELETE",
      `/prompts/${saved.id}?owner=${CAMILLE}`,
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ deleted: saved.id });
    expect(running.store?.listFor(CAMILLE)).toEqual([]);
  });

  it("does not serve the routes when the stack was started without the store", async () => {
    await running.close();
    running = await start(false);
    const res = await call(running, "GET", `/prompts?owner=${CAMILLE}`);
    expect(res.status).toBe(404);
  });
});
