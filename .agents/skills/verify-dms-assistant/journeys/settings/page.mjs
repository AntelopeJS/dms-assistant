import { sampleChangeSets, sampleConversations } from "../../sample.mjs";
import { seedStore } from "../../seed.mjs";
import { ai, check, clickUntil, freshSidecar, list, pageHas, pick, same, selected, shownBy, text, until } from "../../ai.mjs";
import { DEFAULTS, settings, picked } from "./helpers.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

const CLAUDE_NTH = 0;
const CODEX_NTH = 1;

export const pageJourneys = [
  {
    id: "the-page-saves-each-change-as-you-make-it",
    title: "the Settings page saves a choice, a switch and a menu the moment you change them, each agent's default mode and every guard rail through the Guard rails card on its own, and a reload shows them kept",
    entryPoint: "/modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("the page", [pageHas(tab, "says it saves instantly", /Saved instantly/), pageHas(tab, "has the usage section", /Tokens · last 14 days/i)]);
      await tab.click({ role: "radio", name: "Plan only", nth: CLAUDE_NTH });
      await tab.click({ role: "radio", name: "Accept edits", nth: CODEX_NTH });
      await tab.click({ role: "radio", name: "Low" });
      await tab.click({ role: "switch", name: "Adding or removing dependencies" });
      await tab.click({ role: "switch", name: "Notify me in the DMS" });
      await tab.click({ role: "switch", name: "Machine-local skills" });
      await tab.click({ role: "combobox", name: "Deny after" });
      await tab.click({ role: "option", name: "15 minutes" });
      await tab.click({ role: "combobox", name: "Undo history" });
      await tab.click({ role: "option", name: "Keep 90 days" });
      const saved = await until(async () => {
        const body = await settings(ctx, "read");
        return pick(body, "defaultModeClaude") === "plan" && pick(body, "defaultModeCodex") === "acceptEdits" && pick(body, "checkpointRetentionDays") === "90" && pick(body, "requestTimeoutMinutes") === "15";
      });
      const body = await settings(ctx, "read the saved form");
      await ctx.verify("every choice reached the sidecar", [
        check("saved", saved, saved),
        same("the default mode on Claude Code", pick(body, "defaultModeClaude"), "plan"),
        same("the default mode on Codex", pick(body, "defaultModeCodex"), "acceptEdits"),
        same("thinking", pick(body, "thinking"), "low"),
        same("dependencies switch", pick(body, "alwaysAskDependencies"), false),
        same("notify switch", pick(body, "notifyRequests"), false),
        same("local skills switch", pick(body, "allowLocalSkills"), true),
        same("deny after", pick(body, "requestTimeoutMinutes"), "15"),
        same("checkpoints", pick(body, "checkpointRetentionDays"), "90"),
        same("the untouched switch", pick(body, "alwaysAskBlockRemoval"), true),
        same("the untouched scope", pick(body, "generationMode"), "safe"),
      ]);
      await tab.reload();
      await ctx.verify("a reload shows them", [
        selected(tab, { role: "radio", name: "Plan only", nth: CLAUDE_NTH }, true),
        selected(tab, { role: "radio", name: "Auto review" }, false),
        selected(tab, { role: "radio", name: "Accept edits", nth: CODEX_NTH }, true),
        selected(tab, { role: "radio", name: "Ask first", nth: CODEX_NTH }, false),
        selected(tab, { role: "radio", name: "Plan only", nth: CODEX_NTH }, false),
        selected(tab, { role: "radio", name: "Low" }, true),
        selected(tab, { role: "switch", name: "Adding or removing dependencies" }, false),
        selected(tab, { role: "switch", name: "Removing or moving Builder blocks" }, true),
        selected(tab, { role: "switch", name: "Notify me in the DMS" }, false),
        selected(tab, { role: "switch", name: "Machine-local skills" }, true),
        shownBy(tab, { role: "combobox", name: "Deny after" }, "15 minutes"),
        shownBy(tab, { role: "combobox", name: "Undo history" }, "Keep 90 days"),
      ]);
    },
  },
  {
    id: "the-page-disables-what-this-machine-cannot-do",
    title: "Codex is disabled with its reason while signed out, Codex's default mode has no Auto review and no Full auto is offered as a default, the Safe mode switch is enabled because the DMS carries the Builder, and the deletions switch is locked on",
    entryPoint: "/modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("what is disabled and what is not", [
        tab.enabled({ role: "radio", name: "Codex" }, { disabled: true }),
        tab.enabled({ role: "radio", name: "Claude Code" }),
        tab.enabled({ role: "switch", name: "Safe mode" }),
        pageHas(tab, "Codex says why", /Sign in with ChatGPT below to run Codex on your ChatGPT plan\./),
        pageHas(tab, "Safe mode has no missing-Builder reason", /Needs the builder, which isn't running\./, false),
        tab.count({ role: "radio", name: "Full auto" }, 0),
        tab.count({ role: "radio", name: "Auto review" }, 1),
        tab.count({ role: "radio", name: "Ask first" }, 2),
        pageHas(tab, "deletions are locked", /Locked\. The chat asks for your approval on a card before each one runs\./),
        tab.enabled({ role: "switch", name: "Deleting pages, tables, fields or queries" }, { disabled: true }),
        selected(tab, { role: "switch", name: "Deleting pages, tables, fields or queries" }, true),
        selected(tab, { role: "radio", name: "Claude Code" }, true),
        selected(tab, { role: "radio", name: "Medium" }, true),
        selected(tab, { role: "radio", name: "Auto review" }, true),
        selected(tab, { role: "radio", name: "Ask first", nth: CODEX_NTH }, true),
        selected(tab, { role: "switch", name: "Safe mode" }, true),
      ]);
      const chosen = list((await ai(ctx, "read", "GET", "/settings")).body, "x").length;
      await ctx.verify("nothing was changed by looking", [same("defaults", picked(await settings(ctx, "read")), DEFAULTS), same("no rows", chosen, 0)]);
    },
  },
  {
    id: "the-menus-and-choices-offer-exactly-the-documented-options",
    title: "Deny after offers 5, 15 and 30 minutes and Undo history Keep 7, 30 and 90 days, nothing else; Thinking has four choices, the agent two, the default mode on Claude Code four and on Codex three",
    entryPoint: "/modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      const options = async (/** @type {string} */ name) => {
        await clickUntil(tab, { role: "combobox", name }, /minutes|days/);
        const found = await tab.page.getByRole("option").allTextContents();
        await tab.press("Escape");
        return found.map((entry) => entry.trim());
      };
      await ctx.verify("the menus", [
        same("Deny after: 5, 15 and 30 minutes", await options("Deny after"), ["5 minutes", "15 minutes", "30 minutes"]),
        same("Undo history: 7, 30 and 90 days", await options("Undo history"), ["Keep 7 days", "Keep 30 days", "Keep 90 days"]),
      ]);
      const radiosOf = async (/** @type {number} */ group, /** @type {string[]} */ expected) => {
        const scope = tab.page.getByRole("radiogroup").nth(group);
        const found = await Promise.all(expected.map(async (name) => ((await scope.getByRole("radio", { name, exact: true }).count()) === 1 ? name : "")));
        const total = await scope.getByRole("radio").count();
        return total === expected.length ? found : [...found, `${total} radios`];
      };
      await ctx.verify("the choices", [
        same("four groups of radio buttons", await tab.page.getByRole("radiogroup").count(), 4),
        check("13 radio buttons in all", (await tab.page.getByRole("radio").count()) === 13, await tab.page.getByRole("radio").count()),
        same("the agent", await radiosOf(0, ["Claude Code", "Codex"]), ["Claude Code", "Codex"]),
        same("Thinking", await radiosOf(1, ["Off", "Low", "Medium", "High"]), ["Off", "Low", "Medium", "High"]),
        same("the default mode on Claude Code", await radiosOf(2, ["Ask first", "Auto review", "Accept edits", "Plan only"]), ["Ask first", "Auto review", "Accept edits", "Plan only"]),
        same("the default mode on Codex, which has no Auto review", await radiosOf(3, ["Ask first", "Accept edits", "Plan only"]), ["Ask first", "Accept edits", "Plan only"]),
        check("six switches: the five of the Guard rails card and Notify me", (await tab.page.getByRole("switch").count()) === 6, await tab.page.getByRole("switch").count()),
      ]);
    },
  },
  {
    id: "every-label-of-the-page-is-the-documented-one",
    title: "the Settings page carries each section, setting, option, hint and banner label the docs name, in the documented order",
    entryPoint: "/modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      const inOrder = (/** @type {string[]} */ labels) => new RegExp(labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*"), "i");
      await ctx.verify("the page, top to bottom", [
        pageHas(tab, "the title and its subtitle", /Settings\s*Defaults for new conversations\. Changes save as you go/),
        pageHas(tab, "the banner", inOrder(["Saved instantly", "Run Codex on your ChatGPT plan", "Sign in with ChatGPT", "Paste the return address"])),
        pageHas(tab, "the sections, AI then Builder then the Guard rails card then Usage", inOrder(["AI", "Builder", "Guard rails", "Usage"])),
        pageHas(tab, "the AI section", inOrder(["Coding agent", "Claude Code", "Codex", "Claude model", "Thinking", "Off", "Low", "Medium", "High", "Unanswered requests", "Deny after", "Notify me in the DMS"])),
        pageHas(tab, "the Guard rails card says what it holds", inOrder(["Guard rails", "What the agent may do without asking you."])),
        pageHas(tab, "the default mode on Claude Code", inOrder(["Default mode on Claude Code", "Ask first", "Auto review", "Accept edits", "Plan only", "Default mode on Codex"])),
        pageHas(tab, "the default mode on Codex, then Safe mode", inOrder(["Default mode on Codex", "Ask first", "Accept edits", "Plan only", "Safe mode"])),
        pageHas(tab, "Claude Code's mode hint", /What Claude Code may do without asking you first\. Auto review is the recommended default\./),
        pageHas(tab, "Codex's mode hint", /What Codex may do without asking you first\. Codex has no Auto review\./),
        pageHas(tab, "what Auto review does", /A safety check approves routine file edits and web access\./),
        pageHas(tab, "what Accept edits does with Codex", /With Codex, works as Ask first: asks before every file edit/),
        pageHas(tab, "Full auto is not offered", /Full auto/, false),
        pageHas(tab, "the Builder section", inOrder(["Builder", "Applies in development only.", "Undo history", "Keep 30 days"])),
        pageHas(tab, "Safe mode, the asks and local skills, in the Guard rails card", inOrder(["Safe mode", "Only page and data edits through the DMS tools", "Always ask for", "Deleting pages, tables, fields or queries", "Adding or removing dependencies", "Removing or moving Builder blocks", "Machine-local skills"])),
        pageHas(tab, "the usage section", inOrder(["Usage", "Tokens · last 14 days", "Last 14 days", "Tokens", "Conversations"])),
        pageHas(tab, "the hints", /Applies to new turns\. Open chats lose the agent's memory; transcripts stay\./),
        pageHas(tab, "the thinking hint", /Applies from the next message/),
        pageHas(tab, "the approvals hint", /Applies to new conversations/),
        pageHas(tab, "the Always ask for hint", /These ask in every mode\./),
        pageHas(tab, "the dependencies hint", /Package installs and removals run by a command\./),
        pageHas(tab, "the Builder blocks hint", /Even when other Builder operations run automatically\./),
        pageHas(tab, "the unanswered hint", /What happens to a request nobody answers\./),
        pageHas(tab, "the notify hint", /Shows a toast when a request arrives while the assistant panel is closed\./),
        pageHas(tab, "the local skills hint", /Adds skills from ~\/\.claude\/skills on this machine\. Not shared with teammates or other environments\./),
        pageHas(tab, "the undo history hint", /Change sets older than this can no longer be undone\./),
        pageHas(tab, "the usage hint", /Counted per conversation\. Your provider bills them\./),
      ]);
    },
  },
  {
    id: "usage-counts-the-stored-tokens-of-the-last-14-days",
    title: "the Usage section totals the tokens of the conversations of the last 14 days (1,700 over 3 conversations here), leaves out older ones, and names the biggest conversation",
    entryPoint: "GET /ai/metrics/usage, /usage/summary, /modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      const now = Date.now();
      await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
      const usage = await ai(ctx, "usage", "GET", "/metrics/usage");
      const summary = await ai(ctx, "summary", "GET", "/metrics/usage/summary");
      const days = list(usage.body, "series").flatMap((series) => list(series, "data"));
      await ctx.verify("the routes", [
        same("14 days", days.length, 14),
        same("the total: 1000 + 400 + 300 on the first day, not the 700 a day before", pick(usage.body, "value"), 1700),
        same("the days add up to it", days.reduce((total, day) => total + Number(pick(day, "y")), 0), 1700),
        same("the summary rows", list(summary.body, "items").map((row) => [text(row, "id"), pick(row, "value")]), [["tokens", 1700], ["conversations", 3], ["top", "Add a revenue chart"]]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("the section", [pageHas(tab, "tokens and conversations", /Tokens\s*1,700\s*Conversations\s*3/i), pageHas(tab, "the biggest conversation", /Add a revenue chart/)]);
    },
  },
  {
    id: "usage-counts-nothing-before-a-conversation",
    title: "the Usage section and its routes count zero tokens and zero conversations over 14 days before any turn ran",
    entryPoint: "GET /ai/metrics/usage, /ai/metrics/usage/summary, the Usage section",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const usage = await ai(ctx, "usage", "GET", "/metrics/usage");
      const summary = await ai(ctx, "summary", "GET", "/metrics/usage/summary");
      const days = list(usage.body, "series").flatMap((series) => list(series, "data"));
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("zero", [
        same("a total of zero", pick(usage.body, "value"), 0),
        same("fourteen days", days.length, 14),
        same("every day is zero", days.every((day) => pick(day, "y") === 0), true),
        same("the two summary rows", list(summary.body, "items").map((row) => [text(row, "id"), pick(row, "value")]), [["tokens", 0], ["conversations", 0]]),
        pageHas(tab, "the section", /Tokens\s*0\s*Conversations\s*0/i),
      ]);
    },
  },
];
