import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { PAGE_IDS, PAGE_ORDER } from "../../constants/pages";
import { blockMeta, pageMenu } from "../meta";

/**
 * AI Prompts — the prompts the signed-in member saved under a name, to run
 * again: the list with Run, Edit and Delete, and the editor that saves a new
 * one. Run opens the chat on a new conversation and sends the prompt, so the
 * view is the assistant's own, fed by `/ai/prompts`.
 */
@RegisterPage()
export class AISavedPromptsPage extends PageController(
  PAGE_IDS.PROMPTS,
  pageMenu(PAGE_IDS.PROMPTS, "i-ph-bookmark-simple", PAGE_ORDER.PROMPTS),
  DefaultLayout(),
) {
  static prompts = CustomComponent("DmsAssistantSavedPrompts").meta(
    blockMeta("prompts.view", "i-ph-bookmark-simple"),
  );
}
