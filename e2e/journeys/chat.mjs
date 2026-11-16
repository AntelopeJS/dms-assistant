import { guarded } from "../guard.mjs";
import { ai, check, freshSidecar, pageHas, pause, same, statusIs, text } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */
/** @typedef {import("../ai.mjs").Tab} Tab */

const LAUNCHER = "Assistant (Ctrl+Shift+K)";
const POPUP_PREFERENCES = "dms-assistant:onboarding";
const WARM_UP_ATTEMPTS = 5;
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

export const journeys = guarded([
  {
    id: "a-production-dashboard-shows-no-assistant",
    title: "the production dashboard `dms-control` runs shows no Assistant launcher, no side panel and no palette assistant, whatever the shortcut, while the backend's sidecar runs and the pages work",
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
]);
