import { bodyText, check, pageHas, pause, until } from "../../ai.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const TOAST_WATCH_MS = 4000;
const HYDRATION_MS = 2000;
const NAVIGATION_MARK = "verifyClientNavigation";
const ERROR_TOAST = /An unexpected error occurred/;

/**
 * The Settings page while the sidecar is turned off, reached from Changes as
 * the owner does: the dashboard then loads it in the browser, where a failed
 * load also raises a toast. It shows the offline banner, and neither the
 * form's failed load nor that toast.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../ai.mjs").Check[]>} The checks
 */
export async function settingsWithoutSidecar(ctx) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await tab.goto("/modules/ai/changes");
  const changes = await pageHas(tab, "the Changes page shows", /Every turn that touched the project/);
  await pause(HYDRATION_MS);
  await tab.page.evaluate((mark) => Object.assign(window, { [mark]: true }), NAVIGATION_MARK);
  await tab.click({ role: "link", name: "Settings", exact: true });
  const banner = await pageHas(tab, "says it is turned off", /Its sidecar is turned off in this module's configuration\./);
  const inBrowser = await tab.page.evaluate((mark) => mark in window, NAVIGATION_MARK);
  const toast = await until(async () => ERROR_TOAST.test(await bodyText(tab)), { timeoutMs: TOAST_WATCH_MS, everyMs: 250 });
  return [
    changes,
    check("Settings loads in the browser, not from the server", inBrowser, String(inBrowser)),
    banner,
    check(`shows no error toast within ${TOAST_WATCH_MS} ms`, !toast, toast ? "toast shown" : "none"),
    await pageHas(tab, "has no Restart assistant button", /Restart assistant/, false),
    await pageHas(tab, "shows no failed entry load", /Couldn't load this entry/, false),
    await pageHas(tab, "keeps the Usage figures", /Tokens used per day/),
  ];
}
