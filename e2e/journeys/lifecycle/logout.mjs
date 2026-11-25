import { bodyText, check, freshSidecar, until } from "../../ai.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const ASSISTANT_PAGES = ["/modules/ai/settings", "/modules/ai/changes", "/modules/ai/activity"];
const CHANNEL_PATH = "/ai/channel/events";
const ADMIN_MENU = "Verify Admin";
const AFTER_LOGOUT_MS = 5000;
const TOAST = /An unexpected error occurred|Restoring your session/;

/**
 * Signs the owner in on `path`, waits for the assistant's stream, logs out
 * through the user menu and watches the login page: it records every /ai/*
 * request the tab sends once the login page shows, every /ai/* request sent
 * after the click that answers 401, and whether a toast shows.
 *
 * @param {Ctx} ctx The journey
 * @param {string} path The Assistant page
 * @returns {Promise<import("../../ai.mjs").Check[]>} The checks
 */
async function logoutFrom(ctx, path) {
  const tab = await ctx.tab();
  /** @type {string[]} */
  const requests = [];
  /** @type {string[]} */
  const refused = [];
  /** @type {WeakSet<import("@playwright/test").Request>} */
  const sentAfterClick = new WeakSet();
  /** @type {"in" | "clicked" | "out"} */
  let phase = "in";
  const aiPath = (/** @type {string} */ url) => {
    const { pathname } = new URL(url);
    return pathname.startsWith("/ai/") ? pathname : null;
  };
  tab.page.on("request", (request) => {
    const pathname = aiPath(request.url());
    if (pathname === null) return;
    requests.push(`${phase} ${request.method()} ${pathname}`);
    if (phase !== "in") sentAfterClick.add(request);
  });
  tab.page.on("response", (response) => {
    const pathname = aiPath(response.url());
    if (pathname !== null && sentAfterClick.has(response.request()) && response.status() === 401) refused.push(pathname);
  });
  await tab.signIn("admin");
  await tab.goto(path);
  const streaming = await until(() => requests.includes(`in GET ${CHANNEL_PATH}`));
  await tab.click({ role: "button", name: ADMIN_MENU });
  phase = "clicked";
  await tab.click({ role: "menuitem", name: "Logout" });
  const login = await tab.at(/^\/auth/);
  phase = "out";
  const toast = await until(async () => TOAST.test(await bodyText(tab)), { timeoutMs: AFTER_LOGOUT_MS, everyMs: 250 });
  const after = requests.filter((entry) => entry.startsWith("out "));
  return [
    check(`${path} opens the assistant's stream`, Boolean(streaming), requests),
    { ...login, name: `logout from ${path} lands on the login page` },
    check(`no toast within ${AFTER_LOGOUT_MS} ms of the logout from ${path}`, !toast, toast ? "toast shown" : "none"),
    check(`no /ai/* request answers 401 after the logout from ${path}`, refused.length === 0, refused),
    check(`no /ai/* request once the login page shows after the logout from ${path}`, after.length === 0, after),
  ];
}

export const logoutJourneys = [
  {
    id: "logout-stops-the-assistant",
    title: "logging out from each Assistant page lands on the login page with no toast, and the tab sends no further /ai/* request",
    entryPoint: "the user menu's Logout on /modules/ai/settings, /modules/ai/changes and /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      for (const path of ASSISTANT_PAGES) await ctx.verify(`logout from ${path}`, await logoutFrom(ctx, path));
    },
  },
];
