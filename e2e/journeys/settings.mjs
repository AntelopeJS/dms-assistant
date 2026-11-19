import { guarded } from "../guard.mjs";
import { byRunner } from "../runner.mjs";
import { writeFileSync } from "node:fs";
import { ai, check, freshSidecar, pick, same, sidecarPath, statusIs, stopBackend, text, until } from "../ai.mjs";
import { DEFAULTS, putSettings, settings, picked } from "./settings/helpers.mjs";
import { pageJourneys } from "./settings/page.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

export const { journeys, integrationJourneys } = byRunner(
  guarded([
  {
    id: "the-defaults-are-the-documented-ones",
    integration: true,
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
    integration: true,
    title: "each field saves on its own, the form's fields without the assistant UI's header and each guard rail with it, the others stay, and all of them survive a sidecar restart and a backend restart",
    entryPoint: "PUT /ai/settings, POST /ai/sidecar/restart",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const changes = [
        ["provider", "codex"], ["defaultModeClaude", "plan"], ["defaultModeCodex", "acceptEdits"], ["thinking", "off"], ["claudeModel", "claude-test-model"], ["generationMode", "vibe"], ["allowLocalSkills", true],
        ["alwaysAskDependencies", false], ["alwaysAskBlockRemoval", false], ["requestTimeoutMinutes", "30"], ["notifyRequests", false], ["checkpointRetentionDays", "90"],
      ];
      const expected = { ...DEFAULTS };
      for (const [key, value] of changes) {
        const answer = await putSettings(ctx, `save ${key}`, { [key]: value });
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
    integration: true,
    title: "the Safe mode switch of the form is the stored scope: on reads safe, off reads vibe, each save writes the scope and not the switch, and a value that is not a boolean is refused",
    entryPoint: "GET /ai/settings, PUT /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const initial = await settings(ctx, "read the default");
      const off = await putSettings(ctx, "switch Safe mode off", { safeMode: false });
      const stored = await settings(ctx, "read after off");
      const on = await putSettings(ctx, "switch Safe mode on", { safeMode: true });
      const refused = await putSettings(ctx, "a switch that is not a boolean", { safeMode: "yes" });
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
    integration: true,
    title: "a settings file left by an earlier run is read when the assistant starts: each field it holds is used, a value or a key the file should not hold is ignored while the default stays, and the retired single mode is ignored so a file that holds only it starts both agents on their defaults",
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
      /** @type {{ mode: string, read: unknown }[]} */
      const retired = [];
      for (const mode of ["normal", "auto", "acceptEdits", "plan"]) {
        retired.push({ mode, read: await startOn(`read a file with only the retired mode ${mode}`, { mode }) });
      }
      await ctx.verify("a file with only the retired single mode", [
        ...retired.map(({ mode, read }) => same(`${mode} is ignored and both agents start on their defaults`, modes(read), ["auto", "normal"])),
        ...retired.map(({ mode, read }) => same(`${mode} is not served`, pick(read, "mode"), undefined)),
      ]);
    },
  },
  {
    id: "a-value-outside-the-options-is-refused-and-changes-nothing",
    integration: true,
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
        const answer = await putSettings(ctx, `refuse ${JSON.stringify(body)}`, body);
        checks.push(same(`${JSON.stringify(body)} is 400`, answer.status, 400), check(`${JSON.stringify(body)} says why`, reason.test(text(answer.body, "message")), text(answer.body, "message")));
      }
      await ctx.verify("every refusal", checks);
      const odd = await putSettings(ctx, "unknown field and the locked switch", { nonsense: 1, mode: "plan", alwaysAskDeletions: false });
      await ctx.verify("what cannot be written", [
        same("200", odd.status, 200),
        same("deletions still ask", pick(odd.body, "alwaysAskDeletions"), true),
        same("the unknown field is not stored", pick(odd.body, "nonsense"), undefined),
        same("nothing else moved", picked(await settings(ctx, "read")), DEFAULTS),
      ]);
    },
  },
  {
    id: "a-guard-rail-needs-the-assistant-uis-header",
    integration: true,
    title: "the owner's PUT of a guard rail (a default mode, Safe mode, an ask, local skills, or a key the module does not name as free) without the assistant UI's header answers 403 and changes nothing, a free key mixed with one is refused whole, a free key saves without the header, and the same guard rail with the header saves",
    entryPoint: "PUT /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const forged = [
        { defaultModeClaude: "plan" }, { defaultModeCodex: "plan" }, { safeMode: false }, { generationMode: "vibe" }, { defaultModes: { claude: "plan" } },
        { alwaysAskDependencies: false }, { alwaysAskBlockRemoval: false }, { allowLocalSkills: true }, { thinking: "high", allowLocalSkills: true }, { nonsense: 1 },
      ];
      const checks = [];
      for (const body of forged) {
        const answer = await ai(ctx, `without the header ${JSON.stringify(body)}`, "PUT", "/settings", { body });
        checks.push(same(`${JSON.stringify(body)} is refused`, [answer.status, text(answer.body, "code")], [403, "forbidden"]));
      }
      await ctx.verify("the forged writes", [...checks, same("and nothing changed", picked(await settings(ctx, "read after the refusals")), DEFAULTS)]);
      const free = await ai(ctx, "a free key without the header", "PUT", "/settings", { body: { thinking: "high" } });
      const marked = await putSettings(ctx, "a guard rail with the header", { allowLocalSkills: true });
      await ctx.verify("what the form and the card may write", [
        same("a free key saves without the header", [free.status, pick(free.body, "thinking")], [200, "high"]),
        same("a guard rail saves with it", [marked.status, pick(marked.body, "allowLocalSkills")], [200, true]),
        same("a read agrees", picked(await settings(ctx, "read")), { ...DEFAULTS, thinking: "high", allowLocalSkills: true }),
      ]);
    },
  },
  ...pageJourneys,
  ]),
);

/** The user-facing files these journeys cover, as globs relative to the repository root. */
export const covers = [
  "src/routes/settings.ts",
  "src/routes/owner-ui.ts",
  "frontend-vue/app/components/GuardRails.vue",
  "frontend-vue/app/views/guard-rails.ts",
  "frontend-vue/app/views/composables/useGuardRails.ts",
  "src/routes/metrics.ts",
  "src/routes/metric-shapes.ts",
  "src/types/metrics.ts",
  "sidecar/src/metrics/**",
  "sidecar/src/skills/**",
  "sidecar/src/constants/skills.ts",
  "src/sidecar/settings-values.ts",
  "src/pages/settings/**",
  "sidecar/src/state/settings-store.ts",
  "sidecar/src/state/settings-types.ts",
  "sidecar/src/constants/settings.ts",
  "sidecar/src/state/store.ts",
  "sidecar/src/state/conversations.ts",
];
