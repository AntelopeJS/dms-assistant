import {
  Banner,
  ChartCard,
  ChartColumn,
  Form,
  KeyValueList,
  Section,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { FormPageLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { PAGE_IDS, PAGE_ORDER, PAGE_ROUTES } from "../../constants/pages";
import { blockMeta, blockText, DAY_AXIS, pageMenu } from "../meta";
import { applySidecarSettings } from "./availability";
import { SETTINGS_SECTIONS } from "./sections";

const USAGE_PATH = "settings.usage";
const USAGE_SUMMARY_ROWS = 3;

const settingsForm = Form({
  fetchUrl: PAGE_ROUTES.SETTINGS,
  submitUrl: PAGE_ROUTES.SETTINGS,
  saveMode: "instant",
  sectionNav: "none",
  sections: SETTINGS_SECTIONS,
})
  .meta(blockMeta("settings.form", "i-ph-sliders"))
  .onFilter(applySidecarSettings);

/**
 * AI Settings, the module's landing page: what needs the owner (the assistant
 * offline with Restart, a failed turn, requests waiting), the ChatGPT account
 * Codex runs on, the AI and Builder defaults in one form saving each change on
 * its own to `/ai/settings`, the guard rails in a card of the assistant's own
 * (a form's save cannot send the header `/ai/settings` requires to change
 * them), then the tokens the conversations used.
 */
@RegisterPage()
export class AISettingsPage extends PageController(
  PAGE_IDS.SETTINGS,
  pageMenu(PAGE_IDS.SETTINGS, "i-ph-gear-six", PAGE_ORDER.SETTINGS),
  FormPageLayout(),
) {
  static attention = Banner({ fetchUrl: PAGE_ROUTES.STATUS_BANNER }).meta(
    blockMeta("settings.status_banner", "i-ph-bell-ringing"),
  );

  static chatgpt = Banner({ fetchUrl: PAGE_ROUTES.CODEX_ACCOUNT_BANNER }).meta(
    blockMeta("settings.chatgpt", "i-ph-open-ai-logo"),
  );

  static settings = settingsForm;

  static guardRails = CustomComponent("DmsAssistantGuardRails").meta(
    blockMeta("settings.guard_rails", "i-ph-shield-check"),
  );

  static usage = Section({
    title: blockText(USAGE_PATH, "title"),
    description: blockText(USAGE_PATH, "caption"),
    card: false,
  })
    .meta(blockMeta(USAGE_PATH, "i-ph-chart-bar"))
    .child(
      "tokens",
      ChartCard({
        title: blockText("settings.usage_chart", "title"),
        description: blockText("settings.usage_chart", "caption"),
        icon: "i-ph-chart-bar",
        fetchUrl: PAGE_ROUTES.USAGE,
        valueFormat: "compact",
        showDelta: false,
        chart: ChartColumn({ xaxisType: "datetime", xAxis: DAY_AXIS }).meta(
          blockMeta("settings.usage_chart_series", "i-ph-chart-bar"),
        ),
      }).meta(blockMeta("settings.usage_chart", "i-ph-chart-bar")),
    )
    .child(
      "summary",
      KeyValueList({
        title: blockText("settings.usage_summary", "title"),
        fetchUrl: PAGE_ROUTES.USAGE_SUMMARY,
        skeletonCount: USAGE_SUMMARY_ROWS,
      }).meta(blockMeta("settings.usage_summary", "i-ph-list-numbers")),
    );
}
