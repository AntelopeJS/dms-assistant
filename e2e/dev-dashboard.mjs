import { pause } from "./ai.mjs";

/** @typedef {import("./ai.mjs").Ctx} Ctx */
/** @typedef {import("./ai.mjs").Tab} Tab */

const POPUP_PREFERENCES = "dms-assistant:onboarding";
const WARM_UP_ATTEMPTS = 5;

/**
 * Ticks the onboarding popup's "Don't show on startup" before any page script of the tab runs, so the popup a
 * development dashboard opens on every page leaves the header to the journey.
 *
 * @param {Tab} tab A new tab
 * @returns {Promise<void>}
 */
export function withoutPopup(tab) {
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
export async function warmUp(ctx, tab, path) {
  for (let attempt = 0; attempt < WARM_UP_ATTEMPTS; attempt += 1) {
    const loaded = await tab.page.goto(`${ctx.state.webUrl}${path}`, { waitUntil: "load", timeout: 60_000 }).then(
      () => true,
      () => false,
    );
    if (loaded) return;
    await pause(2000);
  }
}
