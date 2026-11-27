import { bodyText, check, freshSidecar, statusIs, text, until } from "../../ai.mjs";
import { warmUp, withoutPopup } from "../../dev-dashboard.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const ASSISTANT_PAGES = ["/modules/ai/settings", "/modules/ai/changes", "/modules/ai/activity"];
const CHANNEL_PATH = "/ai/channel/events";
const PAGE_REPORT = "host_page_blocks";
const ADMIN_MENU = "Verify Admin";
const AFTER_LOGOUT_MS = 5000;
const STREAM_TIMEOUT_MS = 60_000;
const TOAST = /An unexpected error occurred|Restoring your session/;

/**
 * The type of the frame a POST to the channel carries, if it carries one.
 *
 * @param {import("@playwright/test").Request} request A request of the tab
 * @returns {unknown} The frame's type
 */
function frameType(request) {
  try {
    return JSON.parse(request.postData() ?? "null")?.type;
  } catch {
    return undefined;
  }
}

/**
 * Signs the owner in on `path`, waits for the assistant's stream and for its
 * report of the page's data blocks to be answered, logs out through the user
 * menu and watches the login page: it records every /ai/* request the tab
 * sends once the login page shows, every /ai/* request sent after the click
 * that answers 401, and whether a toast shows. The warm-up load opens a stream
 * of its own, so only the page the journey logs out from counts toward the
 * wait. The block report leaves once the blocks have stayed unchanged for
 * 700 ms, about when the journey would click: sent during the logout, it
 * reaches the backend after the session is gone.
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
  /** @type {Set<import("@playwright/test").Request>} */
  const unanswered = new Set();
  let firstOfThisLoad = Number.POSITIVE_INFINITY;
  /** @type {import("@playwright/test").Request | null} */
  let pageReport = null;
  /** @type {"in" | "clicked" | "out"} */
  let phase = "in";
  const aiPath = (/** @type {string} */ url) => {
    const { pathname } = new URL(url);
    return pathname.startsWith("/ai/") ? pathname : null;
  };
  const thisLoad = () => requests.slice(firstOfThisLoad);
  tab.page.on("request", (request) => {
    const pathname = aiPath(request.url());
    if (pathname === null) return;
    const streamOpen = thisLoad().includes(`in GET ${CHANNEL_PATH}`);
    requests.push(`${phase} ${request.method()} ${pathname}`);
    if (phase !== "in") sentAfterClick.add(request);
    if (pathname !== CHANNEL_PATH) unanswered.add(request);
    if (streamOpen && frameType(request) === PAGE_REPORT) pageReport ??= request;
  });
  const answered = (/** @type {import("@playwright/test").Request} */ request) => unanswered.delete(request);
  tab.page.on("requestfinished", answered);
  tab.page.on("requestfailed", answered);
  tab.page.on("response", (response) => {
    const pathname = aiPath(response.url());
    if (pathname !== null && sentAfterClick.has(response.request()) && response.status() === 401) refused.push(pathname);
  });
  await withoutPopup(tab);
  await tab.signIn("admin");
  await warmUp(ctx, tab, path);
  firstOfThisLoad = requests.length;
  await tab.goto(path);
  const streaming = await until(() => thisLoad().includes(`in GET ${CHANNEL_PATH}`), { timeoutMs: STREAM_TIMEOUT_MS });
  const reported = await until(() => pageReport !== null && unanswered.size === 0, {
    timeoutMs: STREAM_TIMEOUT_MS,
    everyMs: 100,
  });
  const stillOut = [...unanswered].map((request) => aiPath(request.url()));
  await tab.click({ role: "button", name: ADMIN_MENU });
  phase = "clicked";
  await tab.click({ role: "menuitem", name: "Logout" });
  const login = await tab.at(/^\/auth/);
  phase = "out";
  const toast = await until(async () => TOAST.test(await bodyText(tab)), { timeoutMs: AFTER_LOGOUT_MS, everyMs: 250 });
  const after = requests.filter((entry) => entry.startsWith("out "));
  return [
    check(`${path} opens the assistant's stream`, Boolean(streaming), requests),
    check(`the assistant's report of the blocks of ${path} is answered before the logout`, Boolean(reported), {
      thisLoad: thisLoad(),
      stillOut,
    }),
    { ...login, name: `logout from ${path} lands on the login page` },
    check(`no toast within ${AFTER_LOGOUT_MS} ms of the logout from ${path}`, !toast, toast ? "toast shown" : "none"),
    check(`no /ai/* request answers 401 after the logout from ${path}`, refused.length === 0, refused),
    check(`no /ai/* request once the login page shows after the logout from ${path}`, after.length === 0, after),
  ];
}

export const logoutJourneys = [
  {
    id: "logout-stops-the-assistant",
    frontend: "dev",
    title: "logging out from each Assistant page lands on the login page with no toast, and the tab sends no further /ai/* request",
    entryPoint: "the user menu's Logout on /modules/ai/settings, /modules/ai/changes and /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
      for (const path of ASSISTANT_PAGES) await ctx.verify(`logout from ${path}`, await logoutFrom(ctx, path));
    },
  },
];
