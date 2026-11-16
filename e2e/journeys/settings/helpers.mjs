import { AI, OWNER_UI_HEADERS, ai, pick, raw } from "../../ai.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const DEFAULTS = {
  provider: "claude",
  defaultModeClaude: "auto",
  defaultModeCodex: "normal",
  thinking: "medium",
  claudeModel: "claude-opus-5-5",
  generationMode: "safe",
  allowLocalSkills: false,
  alwaysAskDependencies: true,
  alwaysAskBlockRemoval: true,
  requestTimeoutMinutes: "5",
  notifyRequests: true,
  checkpointRetentionDays: "30",
  alwaysAskDeletions: true,
};

/** The sidecar settings a request may write without the assistant UI's header: the ones the Settings form saves. Every other key is a guard rail. */
export const FREE_SETTINGS = new Set(["provider", "thinking", "claudeModel", "requestTimeoutMinutes", "notifyRequests", "checkpointRetentionDays"]);

/**
 * Saves settings as the page that sends them does: the Settings form sends no header, the Guard rails card sends the assistant UI's header with a guard rail.
 *
 * @param {Ctx} ctx
 * @param {string} label
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ status: number | null, body: unknown }>}
 */
export async function putSettings(ctx, label, body) {
  const holdsGuardRail = Object.keys(body).some((key) => !FREE_SETTINGS.has(key));
  if (!holdsGuardRail) return ai(ctx, label, "PUT", "/settings", { body });
  const sent = await raw(ctx, label, { path: `${AI}/settings`, method: "PUT", as: "admin", headers: { "content-type": "application/json", ...OWNER_UI_HEADERS }, body: JSON.stringify(body) });
  return { status: sent.status, body: sent.json };
}

/** @param {Ctx} ctx @param {string} label */
export async function settings(ctx, label) {
  return (await ai(ctx, label, "GET", "/settings")).body;
}

/** @param {unknown} body */
export function picked(body) {
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, pick(body, key)]));
}
