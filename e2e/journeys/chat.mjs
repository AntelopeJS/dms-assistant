import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { ai, check, freshSidecar, pageHas, pause, same, statusIs, text, until } from "../ai.mjs";
import { projectRoot, writeProjectFile } from "../seed.mjs";
import { scriptedTurn, withMockClaude } from "./chat/mock-claude.mjs";
import { putSettings } from "./settings/helpers.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */
/** @typedef {import("../ai.mjs").Tab} Tab */

const LAUNCHER = "Assistant (Ctrl+Shift+K)";
const COMPOSER = { role: "textbox", name: "Message the assistant", exact: true };
const POPUP_PREFERENCES = "dms-assistant:onboarding";
const WARM_UP_ATTEMPTS = 5;
const TURN_TIMEOUT_MS = 60_000;
const QUESTION = "How is the home page organised?";
const REPLY = ["The home page shows ", "the welcome block ", "above the latest projects."];
const ASK_NOTE = "Add a welcome note";
const NOTE_FOLDER = "notes";
const NOTE = `${NOTE_FOLDER}/welcome.md`;
const NOTE_TEXT = "Welcome to the project.\n";
const ALLOW_EDIT = { role: "button", name: "Allow edit" };
/**
 * Ticks the onboarding popup's "Don't show on startup" before any page script of the tab runs, so the popup a
 * development dashboard opens on every page leaves the header to the journey.
 *
 * @param {Tab} tab A new tab
 * @returns {Promise<void>}
 */
function withoutPopup(tab) {
  return tab.page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ dontShow: true })), POPUP_PREFERENCES);
}

/**
 * Loads a page of the development dashboard until it answers, without recording a step: the first load of a page
 * makes the dev server bundle what it imports, and it resets the connection while it does.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A signed-in tab
 * @param {string} path The page
 * @returns {Promise<void>}
 */
async function warmUp(ctx, tab, path) {
  for (let attempt = 0; attempt < WARM_UP_ATTEMPTS; attempt += 1) {
    const loaded = await tab.page.goto(`${ctx.state.webUrl}${path}`, { waitUntil: "load", timeout: 60_000 }).then(
      () => true,
      () => false,
    );
    if (loaded) return;
    await pause(2000);
  }
}

/**
 * Signs the owner in on the development dashboard's home page and opens the chat panel from the header launcher.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<Tab>} The tab, with the panel open
 */
async function openChat(ctx) {
  const tab = await ctx.tab();
  await withoutPopup(tab);
  await tab.signIn("admin");
  await warmUp(ctx, tab, "/home");
  await tab.goto("/home");
  await tab.click({ role: "button", name: LAUNCHER, exact: true });
  await ctx.verify("the launcher opens the chat panel", [tab.visible(COMPOSER, { timeoutMs: 30_000 })], { critical: true });
  return tab;
}

/**
 * Sends a message from the panel's composer.
 *
 * @param {Tab} tab The tab, with the panel open
 * @param {string} message What the owner asks
 * @returns {Promise<void>}
 */
async function send(tab, message) {
  await tab.fill(COMPOSER, message);
  await tab.press("Enter", COMPOSER);
}

/**
 * The text of the panel's message bubbles of one side of the conversation, in order.
 *
 * @param {Tab} tab The tab, with the panel open
 * @param {"user" | "assistant"} role Whose messages
 * @returns {Promise<string[]>} Their text, whitespace collapsed
 */
async function bubbles(tab, role) {
  const texts = await tab.page.locator(`[data-role="${role}"] .message-bubble`).allInnerTexts();
  return texts.map((entry) => entry.replace(/\s+/g, " ").trim());
}

/**
 * Drives a turn in which Claude creates the welcome note once the owner allows it, from the chat panel of a new
 * chat in Code mode with Ask first, then hands the tab to `after` with the turn's change-set card shown. The fake
 * provider replays the Write call without running it, so the journey writes the file while the call waits for the
 * owner: between the snapshots the turn takes when it starts and when it ends, as the real tool would.
 *
 * @param {Ctx} ctx The journey
 * @param {(tab: Tab, file: string) => Promise<void>} after What the owner does next, given the note's absolute path
 * @returns {Promise<void>}
 */
async function approvedNote(ctx, after) {
  const folder = join(projectRoot(ctx), NOTE_FOLDER);
  const file = join(projectRoot(ctx), NOTE);
  rmSync(folder, { recursive: true, force: true });
  try {
    await approvedNoteTurn(ctx, file, after);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * The turn of `approvedNote`, on the note at `file`.
 *
 * @param {Ctx} ctx The journey
 * @param {string} file The note's absolute path
 * @param {(tab: Tab, file: string) => Promise<void>} after What the owner does next
 * @returns {Promise<void>}
 */
async function approvedNoteTurn(ctx, file, after) {
  const write = { id: "toolu_e2e_write_1", name: "Write", input: { file_path: file, content: NOTE_TEXT }, result: `File created successfully at: ${file}` };
  await withMockClaude(ctx, scriptedTurn({ calls: [write], reply: ["I added ", "the welcome note."], usage: { input: 200, output: 40 } }), async () => {
    await putSettings(ctx, "new chats run in Code mode and ask first", { generationMode: "vibe", defaultModeClaude: "normal" });
    const tab = await openChat(ctx);
    await send(tab, ASK_NOTE);
    await ctx.verify(
      "Claude asks to create the note",
      [tab.visible(ALLOW_EDIT, { timeoutMs: TURN_TIMEOUT_MS }), pageHas(tab, "the request names the new file and its path in the project", /Create welcome\.md\s*notes\/welcome\.md/)],
      { critical: true },
    );
    writeProjectFile(ctx, NOTE, NOTE_TEXT);
    await tab.click(ALLOW_EDIT);
    await ctx.verify("the turn's change set in the chat", [
      tab.shows(/Change applied · #1/i, { timeoutMs: TURN_TIMEOUT_MS }),
      pageHas(tab, "the card counts the file the turn changed", /1 file changed/),
      pageHas(tab, "the card lists the new file", /notes\/welcome\.md\s*new \+1/i),
      pageHas(tab, "the reply follows the approved call", /I added the welcome note\./),
    ]);
    await after(tab, file);
  });
}

export const journeys = guarded([
  {
    id: "a-production-dashboard-shows-no-assistant",
    title: "the production dashboard of the run shows no Assistant launcher, no side panel and no palette assistant, whatever the shortcut, while the backend's sidecar runs and the pages work",
    entryPoint: "the dashboard header, Ctrl+Shift+K, Ctrl+K, /ai/sidecar-info",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const status = await ai(ctx, "status", "GET", "/status");
      const tab = await ctx.tab();
      await tab.signIn("admin");
      for (const path of ["/home", "/modules/ai/settings", "/verify-plain"]) {
        await tab.goto(path);
        await tab.page.waitForTimeout(3000);
        await tab.page.keyboard.press("Control+Shift+K");
        await tab.page.waitForTimeout(1500);
        const launcher = await tab.page.getByRole("button", { name: /^(Open |Close )?(the )?Assistant$/ }).count();
        const panel = await tab.page.getByPlaceholder(/Ask|message/i).count();
        const starters = await tab.page.getByText("Explain how this project is organised").count();
        await ctx.verify(`${path}`, [check("no Assistant button in the header", launcher === 0, launcher), check("no composer after the shortcut", panel === 0, panel), check("no starter prompt", starters === 0, starters)]);
      }
      await tab.page.keyboard.press("Control+K");
      await tab.page.waitForTimeout(1500);
      await ctx.verify("the command palette", [pageHas(tab, "has no Assistant group", /Open the assistant|Review approvals/, false)]);
      await ctx.verify("the backend side", [same("the sidecar runs for a probe all the same", text(status.body, "status"), "ready")]);
    },
  },
  {
    id: "a-cold-development-load-names-the-launcher-in-english-and-in-french",
    title: "on a cold load of the development dashboard the header launcher is named Assistant (Ctrl+Shift+K) without any interaction, in English and, once the owner chose Français, in another browser in French",
    entryPoint: "the header launcher of `ajs dms dev`, Settings > Language & region",
    frontend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
      const tab = await ctx.tab();
      await withoutPopup(tab);
      await tab.signIn("admin");
      await warmUp(ctx, tab, "/settings");
      await tab.goto("/settings");
      await ctx.verify("English: the launcher is named", [
        tab.visible({ role: "heading", name: "Settings", exact: true }, { timeoutMs: 60_000 }),
        tab.visible({ role: "button", name: LAUNCHER, exact: true }, { timeoutMs: 30_000 }),
      ]);
      await tab.goto("/settings/user/region");
      await tab.click({ role: "combobox", name: "Application language" });
      await tab.click({ role: "option", name: "Français" });
      await ctx.verify("the owner chose French", [tab.visible({ role: "heading", name: "Langue et région", exact: true }, { timeoutMs: 30_000 })]);
      ctx.addAccount("admin-fr", { ...ctx.state.accounts.admin });
      const french = await ctx.tab("admin-fr");
      await withoutPopup(french);
      await french.signIn("admin-fr");
      await french.goto("/settings");
      await ctx.verify("French, in another browser: the launcher is named", [
        french.visible({ role: "heading", name: "Paramètres", exact: true }, { timeoutMs: 60_000 }),
        french.visible({ role: "button", name: LAUNCHER, exact: true }, { timeoutMs: 30_000 }),
      ]);
    },
  },
  {
    id: "a-message-sent-from-the-panel-gets-the-reply-claude-streams-and-its-token-count",
    title: "on the development dashboard the owner opens the chat panel from the header launcher and sends a message; the panel shows the message, then the reply Claude (the fake provider) streams for the turn, once and whole, and the tokens the turn reported",
    entryPoint: "the header launcher of `ajs dms dev`, the chat panel's composer",
    frontend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      await withMockClaude(ctx, scriptedTurn({ reply: REPLY, usage: { input: 120, output: 34 } }), async () => {
        const tab = await openChat(ctx);
        await send(tab, QUESTION);
        const counted = await tab.shows(/154 tokens · this chat/, { timeoutMs: TURN_TIMEOUT_MS });
        await ctx.verify("the turn in the panel", [
          counted,
          same("the owner's message", await bubbles(tab, "user"), [QUESTION]),
          same("the reply Claude streamed, once and whole", await bubbles(tab, "assistant"), [REPLY.join("")]),
        ]);
      });
    },
  },
  {
    id: "an-approved-edit-shows-its-change-set-card-and-the-set-on-the-changes-page",
    title: "in Code mode with Ask first, Claude (the fake provider) asks to create a file; the panel shows the request with the file's path, the owner allows it, and the chat shows the change-set card of the turn, which Modules › Assistant › Changes then lists with who asked, the approval and the file's diff",
    entryPoint: "the chat panel's approval dock and change-set card, /modules/ai/changes",
    frontend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      await approvedNote(ctx, async (tab) => {
        await warmUp(ctx, tab, "/modules/ai/changes");
        await tab.goto("/modules/ai/changes");
        await ctx.verify("Modules › Assistant › Changes", [
          pageHas(tab, "one set", /Change sets · 1/i),
          pageHas(tab, "the set, titled with the owner's message, in Code mode", /Add a welcome note #1 · [^\n]*· \+1 −0 · Code mode/),
          pageHas(tab, "who asked, the agent and the approval", /Asked by\s*Verify Admin\s*Agent · scope\s*Claude Code · Code mode\s*Approvals\s*1 needed/),
          pageHas(tab, "the file's diff", /notes\/welcome\.md new \+1\s*@@ -0,0 \+1,1 @@\s*1 \+ Welcome to the project\./),
        ]);
      });
    },
  },
  {
    id: "the-change-set-card-undoes-the-turn-and-redoes-it-on-disk",
    title: "after an approved edit, the owner undoes the turn from its change-set card in the chat: the file Claude (the fake provider) created leaves the project and the card reads Undone with a Redo button; Redo puts the file back and the card reads Change applied again",
    entryPoint: "the Undo and Redo buttons of the chat panel's change-set card",
    frontend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      await approvedNote(ctx, async (tab, file) => {
        await tab.click({ role: "button", name: "Undo", exact: true });
        const removed = await until(() => !existsSync(file), { timeoutMs: 30_000 });
        await ctx.verify("undone from the card", [
          check("the note left the project", removed, existsSync(file) ? readFileSync(file, "utf8") : "absent"),
          tab.shows(/Undone · checkpoint 1 restored/i, { timeoutMs: 30_000 }),
          tab.visible({ role: "button", name: "Redo", exact: true }),
        ]);
        await tab.click({ role: "button", name: "Redo", exact: true });
        const restored = await until(() => existsSync(file), { timeoutMs: 30_000 });
        await ctx.verify("redone from the card", [
          same("the note is back with the text Claude wrote", restored ? readFileSync(file, "utf8") : "absent", NOTE_TEXT),
          tab.shows(/Change applied · #1/i, { timeoutMs: 30_000 }),
          tab.visible({ role: "button", name: "Undo", exact: true }),
        ]);
      });
    },
  },
]);

/** The user-facing files these journeys cover, as globs relative to the repository root. */
export const covers = [
  "frontend-vue/dms.frontend.ts",
  "frontend-vue/app/plugins/**",
  "frontend-vue/app/runtime/**",
  "frontend-vue/app/chat/**",
  "frontend-vue/app/components/**",
  "frontend-vue/i18n/**",
  "src/channels/**",
  "src/routes/channels.ts",
  "src/routes/sidecar-info.ts",
  "sidecar/src/agent/**",
  "sidecar/src/mcp/**",
  "sidecar/src/prompts/**",
  "sidecar/src/providers/claude/**",
  "sidecar/src/providers/registry.ts",
  "sidecar/src/providers/types.ts",
  "sidecar/src/protocol/**",
  "sidecar/src/server/chat-events.ts",
  "sidecar/src/server/chat-socket-registry.ts",
  "sidecar/src/server/conversation-runs.ts",
  "sidecar/src/server/host-command-router.ts",
  "sidecar/src/server/host-page.ts",
  "sidecar/src/server/host-socket-registry.ts",
  "sidecar/src/server/live-turns.ts",
  "sidecar/src/server/navigation-completer.ts",
  "sidecar/src/server/pending-queue.ts",
  "sidecar/src/server/permission-events.ts",
  "sidecar/src/server/raw-data.ts",
  "sidecar/src/server/reload-hold.ts",
  "sidecar/src/server/safety-net.ts",
  "sidecar/src/server/tool-calls.ts",
  "sidecar/src/server/turn-progress.ts",
  "sidecar/src/server/turn-registry.ts",
  "sidecar/src/server/turns.ts",
  "sidecar/src/server/ws.ts",
  "sidecar/src/state/conversations.ts",
  "sidecar/src/state/host-state.ts",
  "sidecar/src/state/store.ts",
  "sidecar/src/state/types.ts",
  "sidecar/src/state/safe-segment.ts",
  "sidecar/src/builder/**",
  "sidecar/src/pages/**",
  "sidecar/src/logs/**",
  "sidecar/src/host/**",
  "sidecar/src/constants/**",
];
