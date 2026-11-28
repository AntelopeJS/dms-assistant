import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { PAGE_IDS, PAGE_ORDER } from "../../constants/pages";
import { blockMeta, pageMenu } from "../meta";

/**
 * AI Artifacts — the reports, tables and charts the assistant saved from its
 * results, drawn from their data by the dashboard. One custom view fed by
 * `/ai/artifacts*`; `?artifact=<id>` opens one.
 */
@RegisterPage()
export class AIArtifactsPage extends PageController(
  PAGE_IDS.ARTIFACTS,
  pageMenu(PAGE_IDS.ARTIFACTS, "i-ph-presentation-chart", PAGE_ORDER.ARTIFACTS),
  DefaultLayout(),
) {
  static artifacts = CustomComponent("DmsAssistantArtifactsView").meta(
    blockMeta("artifacts.view", "i-ph-presentation-chart"),
  );
}
