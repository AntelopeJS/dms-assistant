import { bodyText, check, freshSidecar, statusIs, text, until } from "../../ai.mjs";
import { warmUp, withoutPopup } from "../../dev-dashboard.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const ASSISTANT_PAGES = ["/modules/ai/settings", "/modules/ai/changes", "/modules/ai/activity"];
const CHANNEL_PATH = "/ai/channel/events";
const SESSION_PATH = "/api/_auth/session";
const ADMIN_MENU = "Verify Admin";
const AFTER_LOGOUT_MS = 5000;
const STREAM_TIMEOUT_MS = 60_000;
const TOAST = /An unexpected error occurred|Restoring your session/;
const SCOPE_RELOAD =
  "the session's end changes the async-data scope (`async-data-scope.ts` of @antelopejs/dms), and since @antelopejs/dms-frontend 0.11.9 `setDmsAsyncDataScope` reloads every entry on screen, so the page reads its data again without a session";

/**
 * @param {string} path The Assistant page
 * @returns {string} The name of the check that no /ai/* request sent after the logout from `path` answers 401
 */
function refusedCheck(path) {
  return `no /ai/* request answers 401 after the logout from ${path}`;
}

/**
 * Signs the owner in on `path`, waits for the assistant's stream, logs out
 * through the user menu and watches the login page: it records every /ai/*
 * request the tab sends once the login page shows, every /ai/* request sent
 * after the session's DELETE answered that answers 401, and whether a toast
 * shows. A request sent while that DELETE is out races it on the server, so
 * its 401 says nothing about the tab.
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
  const sentAfterLogout = new WeakSet();
  /** @type {"in" | "clicked" | "out"} */
  let phase = "in";
  let isSessionEnded = false;
  const aiPath = (/** @type {string} */ url) => {
    const { pathname } = new URL(url);
    return pathname.startsWith("/ai/") ? pathname : null;
  };
  tab.page.on("request", (request) => {
    const pathname = aiPath(request.url());
    if (pathname === null) return;
    requests.push(`${phase} ${request.method()} ${pathname}`);
    if (isSessionEnded) sentAfterLogout.add(request);
  });
  tab.page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "DELETE" && new URL(response.url()).pathname === SESSION_PATH) isSessionEnded = true;
    const pathname = aiPath(response.url());
    if (pathname !== null && sentAfterLogout.has(request) && response.status() === 401) refused.push(pathname);
  });
  await withoutPopup(tab);
  await tab.signIn("admin");
  await warmUp(ctx, tab, path);
  await tab.goto(path);
  const streaming = await until(() => requests.includes(`in GET ${CHANNEL_PATH}`), { timeoutMs: STREAM_TIMEOUT_MS });
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
    check(`logout from ${path} ends the session with DELETE ${SESSION_PATH}`, isSessionEnded, requests),
    check(`no toast within ${AFTER_LOGOUT_MS} ms of the logout from ${path}`, !toast, toast ? "toast shown" : "none"),
    check(refusedCheck(path), refused.length === 0, refused),
    check(`no /ai/* request once the login page shows after the logout from ${path}`, after.length === 0, after),
  ];
}

export const logoutJourneys = [
  {
    id: "logout-stops-the-assistant",
    frontend: "dev",
    title: "logging out from each Assistant page lands on the login page with no toast, and the tab sends no further /ai/* request",
    entryPoint: "the user menu's Logout on /modules/ai/settings, /modules/ai/changes and /modules/ai/activity",
    knownFailures: Object.fromEntries(ASSISTANT_PAGES.map((path) => [refusedCheck(path), SCOPE_RELOAD])),
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
      for (const path of ASSISTANT_PAGES) await ctx.verify(`logout from ${path}`, await logoutFrom(ctx, path));
    },
  },
];
