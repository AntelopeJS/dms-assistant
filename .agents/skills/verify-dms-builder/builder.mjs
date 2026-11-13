import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {import("./control.d.ts").Ctx} Ctx
 * @typedef {import("./control.d.ts").Tab} Tab
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** The prefix of the module's HTTP API, which the onboarding's "Start from an existing database" path calls. */
export const BUILDER = "/api/builder";

/** The verification playground's trusted backend calls (`playground/src/fixture.ts`). */
export const FIXTURE = "/verify-builder";

/** The page the playground serves as its homepage, and its address. */
export const BOARD = "/shop/board";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
export function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is string} Whether it is a string
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * Reads a nested field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {unknown} The field, or undefined when a step is missing
 */
export function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (!isRow(current)) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string} The field when it is a string, else the empty string
 */
export function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * The objects of an array field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {Row[]} The array's objects, empty when the field is not an array
 */
export function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * The items of an array field of a JSON answer, whatever they are.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {unknown[]} The array, empty when the field is not an array
 */
export function items(value, ...path) {
  const found = pick(value, ...path);
  return Array.isArray(found) ? found : [];
}

/**
 * A check, in the shape `ctx.record` takes.
 *
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
export function check(name, pass, detail) {
  return { name, pass: pass === true, detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined") };
}

/**
 * A call to the module's HTTP API as the owner (or another account).
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under `/api/builder`, with its query
 * @param {{ body?: unknown, as?: string }} [options] The JSON body, and the account (`admin` by default, `anon` for nobody)
 * @returns {Promise<Answer>} The answer
 */
export function builder(ctx, label, method, path, options = {}) {
  return ctx.api(label, { method, path: `${BUILDER}${path}`, body: options.body, as: options.as });
}

/**
 * @param {Ctx} ctx The journey
 * @param {...string} parts A path under the project the module edits (the run's copy of the playground)
 * @returns {string} The absolute path
 */
export function projectPath(ctx, ...parts) {
  return join(ctx.state.runPlayground ?? ctx.state.playground, ...parts);
}

/**
 * Reads a file of the project the module edits, keeping a copy in the step's evidence.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What is read
 * @param {string} relative The path under the project root
 * @returns {{ text: string, exists: boolean, folder: string }} The file's text, empty when it is missing
 */
export function readProject(ctx, label, relative) {
  const folder = ctx.step(`read ${label}`);
  try {
    const content = readFileSync(projectPath(ctx, relative), "utf8");
    writeFileSync(join(folder, "file.ts.txt"), content);
    return { text: content, exists: true, folder };
  } catch {
    return { text: "", exists: false, folder };
  }
}

/**
 * Restarts the backend with `VERIFY_BUILDER_*` variables set (see `playground/antelope.config.ts`), runs `body`,
 * then restarts it with the variables it had, so later journeys get the module's defaults back.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env The variables
 * @param {() => Promise<void>} body What to do under that configuration
 * @returns {Promise<void>}
 */
export async function withConfig(ctx, env, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * Creates a member of the default tenant whose role holds the given permissions, and signs them up, so journeys act
 * as `name` with `ctx.api(..., { as: name })` and `ctx.tab(name)`.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name
 * @param {string[]} permissions The role's permission ids
 * @returns {Promise<{ roleId: string, userId: string }>} The role and the user
 */
export async function member(ctx, name, permissions) {
  const invite = await ctx.api(`invite ${name}`, { method: "POST", path: `${FIXTURE}/member`, body: { name, permissions }, as: "anon" });
  const email = text(invite.body, "email");
  const password = ctx.password();
  const signup = await ctx.api(`${name} signs up`, {
    method: "POST",
    path: "/api/auth/signup",
    body: { name, email, password, lang: "en", token: text(invite.body, "token") },
    as: "anon",
  });
  const userId = text(signup.body, "user", "_id");
  ctx.addAccount(name, { email, password, userId });
  await ctx.verify(`${name} is a member`, [check("the signup answers a session", signup.status === 200 && userId !== "", signup.status)], { critical: true });
  return { roleId: text(invite.body, "roleId"), userId };
}
