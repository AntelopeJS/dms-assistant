import { guarded } from "../guard.mjs";
import { byRunner } from "../runner.mjs";
import { ai, check, freshSidecar, list, member, pageHas, pick, same, statusIs, text, until } from "../ai.mjs";
import { warmUp, withoutPopup } from "../dev-dashboard.mjs";
import { scriptedTurn, withMockClaude } from "./chat/mock-claude.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

const WEEKLY = { name: "Weekly revenue", text: "Summarise last week's revenue per region." };
const AUDIT = { name: "Audit the orders page", text: "List what the orders page shows and what it lacks." };
const COMPOSER = { role: "textbox", name: "Message the assistant", exact: true };
const TURN_TIMEOUT_MS = 60_000;
const NAME_TAKEN_KEY = "$dms_assistant.errors.prompt_name_taken";

/**
 * Saves a prompt as the owner.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the save is for
 * @param {Record<string, unknown>} prompt The body
 */
function save(ctx, label, prompt) {
  return ai(ctx, label, "POST", "/prompts", { body: prompt });
}

/**
 * The names of the owner's prompts, as the list answers them.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the read is for
 * @returns {Promise<string[]>} The names, in the list's order
 */
async function names(ctx, label) {
  return list((await ai(ctx, label, "GET", "/prompts")).body, "results").map((row) => text(row, "name"));
}

/**
 * The status and the refusal fields of an answer: `[status, code, field, message]`.
 *
 * @param {{ status: number | null, body: unknown }} answer The answer
 * @returns {unknown[]} What the refusal says
 */
function refusal(answer) {
  return [answer.status, text(answer.body, "code"), text(answer.body, "field"), text(answer.body, "message")];
}

export const { journeys, integrationJourneys } = byRunner(
  guarded([
  {
    id: "the-owner-saves-lists-edits-and-deletes-their-prompts",
    integration: true,
    title: "the owner saves a prompt under a name, lists their prompts by name, is refused a second prompt of that name whatever its case, edits one, and deletes one; the list follows every step",
    entryPoint: "GET /ai/prompts, POST /ai/prompts, PUT /ai/prompts/:id, DELETE /ai/prompts/:id",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const empty = await ai(ctx, "the list before any prompt", "GET", "/prompts");
      const saved = await save(ctx, "save a prompt, padded", { name: `  ${WEEKLY.name} `, text: ` ${WEEKLY.text} ` });
      await save(ctx, "save another", AUDIT);
      const listed = await names(ctx, "the list");
      const taken = await save(ctx, "the same name in another case", { name: WEEKLY.name.toLowerCase(), text: "again" });
      const id = text(saved.body, "id");
      const edited = await ai(ctx, "edit the text", "PUT", `/prompts/${id}`, { body: { text: `${WEEKLY.text} Show a table.` } });
      const renamed = await ai(ctx, "rename onto a taken name", "PUT", `/prompts/${id}`, { body: { name: AUDIT.name } });
      const deleted = await ai(ctx, "delete it", "DELETE", `/prompts/${id}`);
      await ctx.verify("the owner's prompts", [
        same("no prompt at first", empty.body, { results: [], total: 0 }),
        same("saved, trimmed, with its id", [saved.status, text(saved.body, "name"), text(saved.body, "text"), id !== ""], [200, WEEKLY.name, WEEKLY.text, true]),
        same("listed by name", listed, [AUDIT.name, WEEKLY.name]),
        same("a second prompt of that name is refused under the name field", refusal(taken), [409, "duplicate_name", "name", NAME_TAKEN_KEY]),
        same("the refusal names the name", pick(taken.body, "params", "name"), WEEKLY.name.toLowerCase()),
        same("the edit keeps the name and changes the text", [edited.status, text(edited.body, "name"), text(edited.body, "text")], [200, WEEKLY.name, `${WEEKLY.text} Show a table.`]),
        same("a rename onto a taken name is refused", refusal(renamed), [409, "duplicate_name", "name", NAME_TAKEN_KEY]),
        same("deleted", [deleted.status, pick(deleted.body, "deleted")], [200, id]),
        same("one prompt left", await names(ctx, "the list after the deletion"), [AUDIT.name]),
      ]);
    },
  },
  {
    id: "a-prompt-the-module-does-not-accept-is-refused-naming-the-field",
    integration: true,
    title: "a prompt without a name, without a text, over the caps or not an object answers 400 with the field and a translated reason; an edit that changes nothing too; an unknown id answers 404; nothing is stored",
    entryPoint: "POST /ai/prompts, PUT /ai/prompts/:id, DELETE /ai/prompts/:id",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      /** @type {[Record<string, string>, string, string][]} */
      const refused = [
        [{ text: "t" }, "name", "prompt_name_required"],
        [{ name: "   ", text: "t" }, "name", "prompt_name_required"],
        [{ name: "n".repeat(81), text: "t" }, "name", "prompt_name_too_long"],
        [{ name: "n" }, "text", "prompt_text_required"],
        [{ name: "n", text: "x".repeat(20_001) }, "text", "prompt_text_too_long"],
      ];
      const checks = [];
      for (const [body, field, key] of refused) {
        const answer = await save(ctx, `refuse ${key}`, body);
        checks.push(same(`${key} is 400 under ${field}`, refusal(answer), [400, "invalid", field, `$dms_assistant.errors.${key}`]));
      }
      const notAnObject = await ai(ctx, "a body that is not an object", "POST", "/prompts", { body: "just text" });
      const emptyEdit = await ai(ctx, "an edit that changes nothing", "PUT", "/prompts/some-id", { body: {} });
      const unknownEdit = await ai(ctx, "an edit of an unknown id", "PUT", "/prompts/unknown", { body: { text: "t" } });
      const unknownDelete = await ai(ctx, "a deletion of an unknown id", "DELETE", "/prompts/unknown");
      await ctx.verify("the refusals", [
        ...checks,
        same("a body that is not an object is 400", [notAnObject.status, text(notAnObject.body, "code")], [400, "invalid"]),
        same("an empty edit is 400", refusal(emptyEdit), [400, "invalid", "", "$dms_assistant.errors.prompt_body"]),
        same("an unknown id is 404 on edit", [unknownEdit.status, text(unknownEdit.body, "message")], [404, "Unknown saved prompt."]),
        same("and on delete", [unknownDelete.status, text(unknownDelete.body, "message")], [404, "Unknown saved prompt."]),
        same("nothing was stored", await names(ctx, "the list after the refusals"), []),
      ]);
    },
  },
  {
    id: "saved-prompts-survive-a-restart-and-answer-the-owner-alone",
    integration: true,
    title: "a saved prompt is still listed after a sidecar restart and a backend restart, and a member whose role holds no permission is refused the list, the save and the deletion",
    entryPoint: "GET /ai/prompts after POST /ai/sidecar/restart and a backend restart, as a member",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await member(ctx, "plain", []);
      const saved = await save(ctx, "save a prompt", WEEKLY);
      const id = text(saved.body, "id");
      await ai(ctx, "restart the sidecar", "POST", "/sidecar/restart");
      await statusIs(ctx, (status) => text(status, "status") === "ready", 60_000);
      const afterSidecar = await names(ctx, "the list after the sidecar restart");
      await ctx.restartBackend();
      await statusIs(ctx, (status) => text(status, "status") === "ready", 60_000);
      const afterBackend = await names(ctx, "the list after the backend restart");
      const memberList = await ai(ctx, "the list as a member", "GET", "/prompts", { as: "plain" });
      const memberSave = await ai(ctx, "a save as a member", "POST", "/prompts", { body: AUDIT, as: "plain" });
      const memberDelete = await ai(ctx, "a deletion as a member", "DELETE", `/prompts/${id}`, { as: "plain" });
      await ctx.verify("what survives and who is let in", [
        same("after the sidecar restart", afterSidecar, [WEEKLY.name]),
        same("after the backend restart", afterBackend, [WEEKLY.name]),
        same("a member is refused the list, the save and the deletion", [memberList.status, memberSave.status, memberDelete.status], [403, 403, 403]),
        same("and changed nothing", await names(ctx, "the owner's list after the member's calls"), [WEEKLY.name]),
      ]);
    },
  },
  {
    id: "the-prompts-page-saves-runs-and-offers-a-prompt",
    title: "the Prompts page says there is no prompt yet, New prompt saves one that the list shows with its text, Run opens the assistant on a new conversation and sends it, and a new chat offers it as a starter that fills the composer unsent",
    entryPoint: "/modules/ai/prompts, the chat panel",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await withMockClaude(ctx, scriptedTurn({ reply: ["Here is ", "last week's revenue per region."], usage: { input: 120, output: 30 } }), async () => {
        const tab = await ctx.tab();
        await withoutPopup(tab);
        await tab.signIn("admin");
        await warmUp(ctx, tab, "/modules/ai/prompts");
        await tab.goto("/modules/ai/prompts");
        await ctx.verify("the empty page", [
          pageHas(tab, "the page title and its subtitle", /Prompts\s*The prompts you saved, to run again from here or from the chat/),
          pageHas(tab, "the empty state", /No saved prompts yet/),
          tab.visible({ role: "button", name: "New prompt", nth: 0 }),
        ]);
        await tab.click({ role: "button", name: "New prompt", nth: 0 });
        await tab.fill({ role: "textbox", name: "Name", exact: true }, WEEKLY.name);
        await tab.fill({ role: "textbox", name: "Prompt", exact: true }, WEEKLY.text);
        await tab.click({ role: "button", name: "Save", exact: true });
        const saved = await until(async () => (await names(ctx, "read after the save")).length === 1);
        await ctx.verify("the saved prompt", [
          check("the backend holds it", saved, saved),
          pageHas(tab, "listed by name", /Weekly revenue/),
          pageHas(tab, "with its text", /Summarise last week's revenue per region\./),
          pageHas(tab, "counted", /1 prompt\b/),
        ]);
        await tab.click({ role: "button", name: "Run", exact: true });
        await ctx.verify("Run opens the chat", [tab.visible(COMPOSER, { timeoutMs: 30_000 })], { critical: true });
        const sent = await until(async () => {
          const bubbles = await tab.page.locator('[data-role="user"] .message-bubble').allInnerTexts();
          return bubbles.some((bubble) => bubble.includes(WEEKLY.text));
        }, { timeoutMs: TURN_TIMEOUT_MS });
        await ctx.verify("the prompt was sent as the first message of a new conversation", [
          check("the prompt is the user's message", sent, sent),
          tab.shows(/Here is last week's revenue per region\./, { timeoutMs: TURN_TIMEOUT_MS }),
        ]);
        await tab.click({ role: "button", name: "New conversation", exact: true });
        await ctx.verify("a new chat offers the saved prompt", [
          pageHas(tab, "the Saved prompts section", /Saved prompts/),
          tab.visible({ role: "button", name: WEEKLY.name, exact: true }),
        ]);
        await tab.click({ role: "button", name: WEEKLY.name, exact: true });
        const draft = await tab.page.getByRole("textbox", { name: "Message the assistant", exact: true }).inputValue();
        await ctx.verify("a click fills the composer without sending", [same("the composer holds the prompt", draft, WEEKLY.text)]);
      });
    },
  },
  ]),
);

/** The user-facing files these journeys cover, as globs relative to the repository root. */
export const covers = [
  "src/routes/prompts.ts",
  "src/routes/prompt-body.ts",
  "src/pages/prompts/**",
  "src/types/prompts.ts",
  "src/constants/prompts.ts",
  "sidecar/src/state/saved-prompts.ts",
  "sidecar/src/server/saved-prompt-routes.ts",
  "sidecar/src/constants/saved-prompts.ts",
  "frontend-vue/app/components/SavedPrompts.vue",
  "frontend-vue/app/views/SavedPromptEditor.vue",
  "frontend-vue/app/views/composables/useSavedPrompts.ts",
  "frontend-vue/app/chat/components/SavePromptModal.vue",
  "frontend-vue/app/chat/composables/useSavedPrompts.ts",
  "frontend-vue/app/chat/types/saved-prompt.ts",
];
