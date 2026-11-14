import { guarded } from "../guard.mjs";
import { writeFileSync } from "node:fs";
import { ai, check, freshSidecar, pick, same, sidecarPath, statusIs, stopBackend, text, until } from "../ai.mjs";
import { DEFAULTS, settings, picked } from "./settings/helpers.mjs";
import { pageJourneys } from "./settings/page.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "the-defaults-are-the-documented-ones",
    title: "a new install answers the documented defaults, and says what this install can do",
    entryPoint: "GET /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const body = await settings(ctx, "read the defaults");
      await ctx.verify("the table of the Settings page", [
        same("every default", picked(body), DEFAULTS),
        same("the capabilities: the Builder, Claude ready, Codex not", [pick(body, "builderAvailable"), pick(body, "providers", "claude", "available"), pick(body, "providers", "codex", "available")], [true, true, false]),
        check("Codex says why", text(body, "providers", "codex", "reason").includes("Sign in with ChatGPT"), text(body, "providers", "codex", "reason")),
        same("the defaults the form can reset to", [pick(body, "defaults", "thinking"), pick(body, "defaults", "requestTimeoutMinutes"), pick(body, "defaults", "checkpointRetentionDays")], ["medium", 5, 30]),
        same("the default mode of each agent", pick(body, "defaults", "defaultModes"), { claude: "auto", codex: "normal" }),
      ]);
    },
  },
  {
    id: "every-setting-saves-alone-and-survives-a-restart",
    title: "each field saves on its own, the others stay, and all of them survive a sidecar restart and a backend restart",
    entryPoint: "PUT /ai/settings, POST /ai/sidecar/restart",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const changes = [
        ["provider", "codex"], ["defaultModeClaude", "plan"], ["defaultModeCodex", "acceptEdits"], ["thinking", "off"], ["claudeModel", "claude-test-model"], ["generationMode", "vibe"], ["allowLocalSkills", true],
        ["alwaysAskDependencies", false], ["alwaysAskBlockRemoval", false], ["requestTimeoutMinutes", "30"], ["notifyRequests", false], ["checkpointRetentionDays", "90"],
      ];
      const expected = { ...DEFAULTS };
      for (const [key, value] of changes) {
        const answer = await ai(ctx, `save ${key}`, "PUT", "/settings", { body: { [key]: value } });
        expected[key] = value;
        await ctx.verify(`${key} saved alone`, [same("the answer is the whole form", picked(answer.body), expected), same("a read agrees", picked(await settings(ctx, `read after ${key}`)), expected)]);
      }
      await ai(ctx, "restart the sidecar", "POST", "/sidecar/restart");
      await until(async () => text((await ai(ctx, "ready", "GET", "/status")).body, "status") === "ready", { timeoutMs: 60_000 });
      await ctx.verify("after a sidecar restart", [same("the same settings", picked(await settings(ctx, "read")), expected)]);
      await ctx.restartBackend();
      await until(async () => text((await ai(ctx, "ready", "GET", "/status")).body, "status") === "ready", { timeoutMs: 60_000 });
      await ctx.verify("after a backend restart", [same("the same settings", picked(await settings(ctx, "read")), expected)]);
    },
  },
  {
    id: "the-safe-mode-switch-saves-the-stored-scope",
    title: "the Safe mode switch of the form is the stored scope: on reads safe, off reads vibe, each save writes the scope and not the switch, and a value that is not a boolean is refused",
    entryPoint: "GET /ai/settings, PUT /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const initial = await settings(ctx, "read the default");
      const off = await ai(ctx, "switch Safe mode off", "PUT", "/settings", { body: { safeMode: false } });
      const stored = await settings(ctx, "read after off");
      const on = await ai(ctx, "switch Safe mode on", "PUT", "/settings", { body: { safeMode: true } });
      const refused = await ai(ctx, "a switch that is not a boolean", "PUT", "/settings", { body: { safeMode: "yes" } });
      await ctx.verify("the switch and the scope", [
        same("on by default, beside the scope", [pick(initial, "safeMode"), pick(initial, "generationMode")], [true, "safe"]),
        same("off answers vibe", [pick(off.body, "safeMode"), pick(off.body, "generationMode")], [false, "vibe"]),
        same("a read agrees", [pick(stored, "safeMode"), pick(stored, "generationMode")], [false, "vibe"]),
        same("on answers safe", [pick(on.body, "safeMode"), pick(on.body, "generationMode")], [true, "safe"]),
        same("a text switch is 400", refused.status, 400),
        same("and changes nothing", pick(await settings(ctx, "read after the refusal"), "generationMode"), "safe"),
      ]);
    },
  },
  {
    id: "a-stored-settings-file-is-read-back-by-the-next-start",
    title: "a settings file left by an earlier run is read when the assistant starts: each field it holds is used, a value or a key the file should not hold is ignored while the default stays, and a file from before the default mode was per agent seeds both agents from its one mode",
    entryPoint: "<project>/node_modules/.cache/dms-assistant/settings.json, GET /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      /** @param {string} label @param {Record<string, unknown>} file */
      const startOn = async (label, file) => {
        await stopBackend(ctx);
        writeFileSync(sidecarPath(ctx, "settings.json"), JSON.stringify(file));
        await ctx.restartBackend();
        await statusIs(ctx, (status) => text(status, "status") === "ready", 60_000);
        return settings(ctx, label);
      };
      const modes = (/** @type {unknown} */ body) => [pick(body, "defaultModeClaude"), pick(body, "defaultModeCodex")];
      const body = await startOn("read what the file holds", { thinking: "high", defaultModes: { claude: "acceptEdits", codex: "plan" }, generationMode: "vibe", claudeModel: "claude-from-file", allowLocalSkills: true, requestTimeoutMinutes: 30, checkpointRetentionDays: 7, notifyRequests: false, provider: "nobody", alwaysAskDependencies: "yes", unknownKey: 1 });
      await ctx.verify("the file", [
        same("the fields it holds", [pick(body, "thinking"), pick(body, "generationMode"), pick(body, "claudeModel"), pick(body, "allowLocalSkills"), pick(body, "requestTimeoutMinutes"), pick(body, "checkpointRetentionDays"), pick(body, "notifyRequests")], ["high", "vibe", "claude-from-file", true, "30", "7", false]),
        same("the default mode of each agent", modes(body), ["acceptEdits", "plan"]),
        same("an unknown provider keeps the default", pick(body, "provider"), "claude"),
        same("a value of the wrong type keeps the default", pick(body, "alwaysAskDependencies"), true),
        same("an unknown key is not served", pick(body, "unknownKey"), undefined),
      ]);
      const refused = await startOn("read a mode Codex has not", { defaultModes: { claude: "plan", codex: "auto" } });
      await ctx.verify("a mode the agent has not", [same("Codex keeps its default and Claude Code its choice", modes(refused), ["plan", "normal"])]);
      const planned = await startOn("read a file with the old mode", { mode: "plan" });
      const reviewed = await startOn("read a file with the old Auto review", { mode: "auto" });
      const asked = await startOn("read a file with the old Ask first", { mode: "normal" });
      await ctx.verify("a file with the one mode of the earlier version", [
        same("Plan only seeds both agents", modes(planned), ["plan", "plan"]),
        same("Auto review, which Codex has not, seeds Ask first on both", modes(reviewed), ["normal", "normal"]),
        same("the old Ask first was never a choice over the default, so Claude Code keeps Auto review", modes(asked), ["auto", "normal"]),
        same("the old key is not served", pick(asked, "mode"), undefined),
      ]);
    },
  },
  {
    id: "a-value-outside-the-options-is-refused-and-changes-nothing",
    title: "a value outside the options answers 400 with its reason, nothing changes, an unknown field (the retired single mode included) is ignored and the deletions switch cannot be turned off",
    entryPoint: "PUT /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const refused = [
        [{ thinking: "bogus" }, /off.*low.*medium.*high/s],
        [{ defaultModeClaude: "full-auto" }, /"normal"\|"auto"\|"acceptEdits"\|"plan"/],
        [{ defaultModeCodex: "auto" }, /"normal"\|"acceptEdits"\|"plan"/],
        [{ generationMode: "code" }, /safe.*vibe/s],
        [{ requestTimeoutMinutes: "7" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: "14" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: "45" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: "60" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: "0" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: 60 }, /5\|15\|30/],
        [{ checkpointRetentionDays: "8" }, /7\|30\|90/],
        [{ checkpointRetentionDays: "14" }, /7\|30\|90/],
        [{ checkpointRetentionDays: "1" }, /7\|30\|90/],
        [{ checkpointRetentionDays: "180" }, /7\|30\|90/],
        [{ checkpointRetentionDays: 180 }, /7\|30\|90/],
        [{ claudeModel: "" }, /Too small/],
      ];
      const checks = [];
      for (const [body, reason] of refused) {
        const answer = await ai(ctx, `refuse ${JSON.stringify(body)}`, "PUT", "/settings", { body });
        checks.push(same(`${JSON.stringify(body)} is 400`, answer.status, 400), check(`${JSON.stringify(body)} says why`, reason.test(text(answer.body, "message")), text(answer.body, "message")));
      }
      await ctx.verify("every refusal", checks);
      const odd = await ai(ctx, "unknown field and the locked switch", "PUT", "/settings", { body: { nonsense: 1, mode: "plan", alwaysAskDeletions: false } });
      await ctx.verify("what cannot be written", [
        same("200", odd.status, 200),
        same("deletions still ask", pick(odd.body, "alwaysAskDeletions"), true),
        same("the unknown field is not stored", pick(odd.body, "nonsense"), undefined),
        same("nothing else moved", picked(await settings(ctx, "read")), DEFAULTS),
      ]);
    },
  },
  ...pageJourneys,
]);
