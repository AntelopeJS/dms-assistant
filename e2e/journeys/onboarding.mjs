import { guarded } from "../guard.mjs";
import { connectJourneys } from "./onboarding/connect.mjs";
import { AI, OWNER_UI_HEADERS, ai, check, freshSidecar, pick, raw, same, sidecarLock, statusIs, text, withEnv } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

const NO_CREDENTIAL = { ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", CLAUDE_CODE_OAUTH_TOKEN: "" };
const ENV_KEY = "sk-ant-verify-not-a-key";

/** @param {Ctx} ctx @param {string} label */
function state(ctx, label) {
  return raw(ctx, label, { path: `${AI}/onboarding`, as: "admin" });
}

export const journeys = guarded([
  {
    id: "the-state-says-where-each-login-stands-and-offers-one-codex-sign-in",
    title: "the first-run popup's state names the provider, says Claude Code and Codex are signed out and offers one ChatGPT sign-in address for the sidecar, the same for every poll, and a Claude credential in the environment reads as signed in from the environment without the key in the answer",
    entryPoint: "GET /ai/onboarding",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await withEnv(ctx, NO_CREDENTIAL, async () => {
        await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
        const lock = sidecarLock(ctx);
        const first = await state(ctx, "the state");
        const second = await state(ctx, "the next poll");
        const url = new URL(text(first.json, "codexLoginUrl") || "http://missing.invalid");
        await ctx.verify("signed out", [
          same("the answer", [first.status, first.headers["cache-control"]], [200, "no-store"]),
          check("a boot id", text(first.json, "bootId").length > 0, text(first.json, "bootId")),
          same("the provider is Claude Code", pick(first.json, "provider"), "claude"),
          same("both logins are signed out", [pick(first.json, "logins", "claude"), pick(first.json, "logins", "codex")], [{ status: "signed-out" }, { status: "signed-out" }]),
          same("one sign-in address, toward OpenAI, back to this sidecar", [url.origin, url.pathname, url.searchParams.get("redirect_uri")], ["https://auth.openai.com", "/api/accounts/authorize", `http://127.0.0.1:${lock?.port}/auth/chatgpt/callback`]),
          same("a poll mints no new attempt", [text(second.json, "codexLoginUrl"), text(second.json, "bootId")], [text(first.json, "codexLoginUrl"), text(first.json, "bootId")]),
        ]);
      });
      await withEnv(ctx, { ...NO_CREDENTIAL, ANTHROPIC_API_KEY: ENV_KEY }, async () => {
        const answer = await state(ctx, "the state with a key in the environment");
        await ctx.verify("a credential in the environment", [
          same("Claude Code is signed in from the environment", pick(answer.json, "logins", "claude"), { status: "signed-in", source: "env" }),
          same("the key is not in the answer", answer.text.includes(ENV_KEY), false),
        ]);
      });
    },
  },
  {
    id: "a-provider-choice-is-saved-and-an-unknown-one-is-refused",
    title: "choosing Codex in the popup is saved as the settings' coding agent whether or not it is signed in, choosing Claude Code goes back, and a provider that does not exist answers 400 and changes nothing",
    entryPoint: "POST /ai/onboarding/provider, GET /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const codex = await ai(ctx, "choose Codex", "POST", "/onboarding/provider", { body: { provider: "codex" } });
      const saved = await ai(ctx, "settings", "GET", "/settings");
      const refused = await ai(ctx, "choose a provider that does not exist", "POST", "/onboarding/provider", { body: { provider: "gemini" } });
      const after = await ai(ctx, "settings after the refusal", "GET", "/settings");
      const back = await ai(ctx, "choose Claude Code", "POST", "/onboarding/provider", { body: { provider: "claude" } });
      await ctx.verify("the provider", [
        same("Codex is the state's provider, still signed out", [codex.status, pick(codex.body, "provider"), pick(codex.body, "logins", "codex", "status")], [200, "codex", "signed-out"]),
        same("and the settings' coding agent", pick(saved.body, "provider"), "codex"),
        same("an unknown provider is 400 with its reason", [refused.status, text(refused.body, "message")], [400, "Unknown provider."]),
        same("and nothing changed", pick(after.body, "provider"), "codex"),
        same("Claude Code again", [back.status, pick(back.body, "provider"), text((await ai(ctx, "settings", "GET", "/settings")).body, "provider")], [200, "claude", "claude"]),
      ]);
    },
  },
  {
    id: "a-pasted-claude-token-is-checked-without-being-stored-or-echoed",
    title: "a pasted Claude token that is missing answers 400, one that is not shaped like a token answers malformed without a request to Anthropic, neither is stored, and no answer carries what was pasted",
    entryPoint: "POST /ai/onboarding/claude-token, GET /ai/onboarding",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await withEnv(ctx, NO_CREDENTIAL, async () => {
        const secret = "sk-ant-secret value";
        const ui = { "content-type": "application/json", ...OWNER_UI_HEADERS };
        const missing = await raw(ctx, "no token", { path: `${AI}/onboarding/claude-token`, method: "POST", as: "admin", headers: ui, body: "{}" });
        const malformed = await raw(ctx, "a token that is not one", { path: `${AI}/onboarding/claude-token`, method: "POST", as: "admin", headers: ui, body: JSON.stringify({ token: secret }) });
        const unmarked = await raw(ctx, "a token without the assistant UI's header", { path: `${AI}/onboarding/claude-token`, method: "POST", as: "admin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: secret }) });
        const after = await state(ctx, "the state after");
        await ctx.verify("the token", [
          same("a missing token is 400 with its reason", [missing.status, text(missing.json, "message")], [400, "Missing token."]),
          same("the owner's token without the assistant UI's header is refused 403", [unmarked.status, text(unmarked.json, "code")], [403, "forbidden"]),
          same("a malformed one answers malformed", [malformed.status, malformed.json], [200, { ok: false, reason: "malformed" }]),
          same("nothing is echoed", [malformed.text.includes("secret"), malformed.headers["cache-control"]], [false, "no-store"]),
          same("nothing is stored: Claude Code stays signed out", pick(after.json, "logins", "claude"), { status: "signed-out" }),
        ]);
      });
    },
  },
  ...connectJourneys,
]);
