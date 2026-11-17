import { MongoClient } from "mongodb";
import { check, parseJson, text } from "../../ai.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */
/** @typedef {import("../../ai.mjs").Tab} Tab */

const CONNECT_STEP = "/home?assistant=connect";
const URL_FIELD = { role: "textbox", name: "Connection URL" };
const CONNECT = { role: "button", name: "Connect and analyse" };
const STEP_HEADING = { role: "heading", name: "Connect your database" };
const RESTART = /Restart the project to load the connection/;
const CONNECT_MEMORY = "dms-assistant:onboarding-connect";
const READER = "reader";
const PASSWORD = "reader-secret";

/**
 * A database of the run's mongod with two collections, a few documents and a user who may read them, for the popup to
 * connect.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The database name
 * @returns {Promise<(password: string) => string>} Its connection URL as that user, with a given password
 */
async function seedSource(ctx, name) {
  const client = new MongoClient(ctx.state.mongoUrl);
  try {
    await client.connect();
    const db = client.db(name);
    await db.collection("customers").insertMany([{ name: "Ada", email: "ada@example.com" }, { name: "Linus", email: "linus@example.com" }]);
    await db.collection("orders").insertMany([{ customer: "Ada", total: 12, status: "paid" }]);
    await db.command({ createUser: READER, pwd: PASSWORD, roles: [{ role: "read", db: name }] });
  } finally {
    await client.close();
  }
  return (password) => {
    const url = new URL(ctx.state.mongoUrl);
    url.username = READER;
    url.password = password;
    url.pathname = `/${name}`;
    return url.toString();
  };
}

/**
 * Waits until one live check of the popup, such as `schema`, reaches a status.
 *
 * @param {Tab} tab The tab
 * @param {string} key The check
 * @param {string} status The status it should reach
 * @param {number} timeoutMs How long to wait
 * @returns {Promise<import("../../ai.mjs").Check>} The check, with the last status and text seen
 */
async function checkReaches(tab, key, status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let seen = "absent";
  while (Date.now() < deadline) {
    const item = tab.page.locator(`[data-check="${key}"]`).first();
    if ((await item.count()) > 0) {
      seen = `${await item.getAttribute("data-status")}: ${(await item.innerText()).trim()}`;
      if (seen.startsWith(`${status}:`)) break;
    }
    await tab.page.waitForTimeout(500);
  }
  return check(`the ${key} check is ${status}`, seen.startsWith(`${status}:`), seen);
}

/**
 * Waits until the tab remembers the connection the popup wrote, which a reload or a reopened popup follows.
 *
 * @param {Tab} tab The tab
 * @param {number} timeoutMs How long to wait
 * @returns {Promise<import("../../ai.mjs").Check>} The check, with the connection the tab remembers
 */
async function remembered(tab, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let connection = "";
  while (Date.now() < deadline && connection === "") {
    const stored = await tab.page.evaluate((key) => sessionStorage.getItem(key) ?? "", CONNECT_MEMORY);
    connection = stored === "" ? "" : text(parseJson(stored), "written", "connection");
    if (connection === "") await tab.page.waitForTimeout(500);
  }
  return check("the tab remembers the written connection", connection !== "", connection || "nothing written yet");
}

/**
 * Opens the popup on its connect step, picks MongoDB, connects with a wrong password, sees the sign-in refused, then
 * connects the corrected URL, sees it pass the live checks, and waits until the tab remembers the connection it wrote.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A signed-in tab of the owner
 * @param {(password: string) => string} url The source database's URL with a password
 * @returns {Promise<void>}
 */
async function connectAfterACorrection(ctx, tab, url) {
  await tab.goto(CONNECT_STEP);
  await ctx.verify("the popup opens on its connect step", [tab.visible(STEP_HEADING, { timeoutMs: 60_000 })], { critical: true });
  await tab.click({ role: "radio", name: "MongoDB" });
  await tab.fill(URL_FIELD, url("wrong-password"));
  await tab.click(CONNECT);
  await ctx.verify("a wrong password is refused at the sign-in, before anything is written", [
    await checkReaches(tab, "reachable", "done", 30_000),
    await checkReaches(tab, "signed-in", "failed", 30_000),
  ]);
  await tab.fill(URL_FIELD, url(PASSWORD));
  await tab.click(CONNECT);
  await ctx.verify("the corrected URL signs in and reads, past the old error", [
    await checkReaches(tab, "signed-in", "done", 30_000),
    await checkReaches(tab, "read", "done", 30_000),
  ]);
  await ctx.verify("the connection is written", [await remembered(tab, 60_000)]);
}

/**
 * What the popup shows of a connection it follows without the URL being typed again: its connect step, the URL field
 * there and empty, and the schema check, each check named after `when`.
 *
 * @param {Tab} tab The tab
 * @param {string} when The moment, such as `after the reload`
 * @param {string} status The status the schema check should reach
 * @param {number} timeoutMs How long to wait for it
 * @returns {Promise<import("../../ai.mjs").Check[]>} The checks
 */
async function followedWithoutTheUrl(tab, when, status, timeoutMs) {
  const open = await tab.visible(STEP_HEADING, { timeoutMs: 60_000 });
  const field = tab.page.getByRole("textbox", { name: "Connection URL" });
  const value = (await field.count()) > 0 ? await field.inputValue() : null;
  const schema = await checkReaches(tab, "schema", status, timeoutMs);
  return [
    check(`${when}: the popup is open on its connect step`, open.pass, open.detail),
    check(`${when}: the URL is not asked again`, value === "", value === null ? "no URL field" : `the field holds ${JSON.stringify(value)}`),
    check(`${when}: ${schema.name}`, schema.pass, schema.detail),
  ];
}

/**
 * Closes the popup when it is open, then opens it again on its connect step.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<void>}
 */
async function closeAndReopen(tab) {
  if ((await tab.page.getByRole("dialog", { name: "Assistant" }).count()) > 0) await tab.click({ role: "button", name: "Close" });
  await tab.goto(CONNECT_STEP);
}

const sourceName = (/** @type {Ctx} */ ctx, /** @type {string} */ prefix) => ctx.unique(prefix).replace(/\W/g, "_");

export const connectJourneys = [
  {
    id: "under-watch-the-connect-popup-follows-the-connection-across-a-reload-and-a-reopen-to-the-analysis",
    title: "under ajs project dev -w the owner connects a MongoDB database in the onboarding popup, corrects a wrong password, reloads the page and closes and opens the popup again while the schema is read, and the popup follows the connection to the analysis without the URL being typed again",
    entryPoint: "the onboarding popup's Connect your database step (`?assistant=connect`) of `ajs dms dev`, `ajs project dev -w`",
    frontend: "dev",
    backend: "watch",
    last: true,
    async run(/** @type {Ctx} */ ctx) {
      const url = await seedSource(ctx, sourceName(ctx, "connect_watch"));
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await connectAfterACorrection(ctx, tab, url);
      await tab.reload();
      await ctx.verify("a reload while the schema is read: the popup follows the connection", await followedWithoutTheUrl(tab, "after the reload", "running", 30_000));
      await closeAndReopen(tab);
      await ctx.verify("closed and opened again: the popup still follows it", await followedWithoutTheUrl(tab, "opened again", "done", 120_000));
      await ctx.verify("the analysis", [await tab.visible({ role: "heading", name: /^Here’s what’s in/ }, { timeoutMs: 30_000 })]);
    },
  },
  {
    id: "without-watch-the-connect-popup-asks-for-a-restart-and-keeps-asking-after-a-reload-and-a-reopen",
    title: "under ajs project dev without -w the owner connects a MongoDB database in the onboarding popup after correcting a wrong password, the popup says to restart the project instead of reading the schema for minutes, and says it again after a reload and after it is closed and opened again, without the URL being typed again",
    entryPoint: "the onboarding popup's Connect your database step (`?assistant=connect`) of `ajs dms dev`, `ajs project dev`",
    frontend: "dev",
    backend: "dev",
    last: true,
    async run(/** @type {Ctx} */ ctx) {
      const url = await seedSource(ctx, sourceName(ctx, "connect_dev"));
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await connectAfterACorrection(ctx, tab, url);
      await ctx.verify("the popup asks for a restart", [await tab.shows(RESTART, { timeoutMs: 60_000 })]);
      await tab.reload();
      await ctx.verify("after a reload it still asks, without the URL", [...(await followedWithoutTheUrl(tab, "after the reload", "running", 30_000)), await tab.shows(RESTART, { timeoutMs: 60_000 })]);
      await closeAndReopen(tab);
      await ctx.verify("closed and opened again it still asks", [...(await followedWithoutTheUrl(tab, "opened again", "running", 30_000)), await tab.shows(RESTART, { timeoutMs: 60_000 })]);
    },
  },
];
