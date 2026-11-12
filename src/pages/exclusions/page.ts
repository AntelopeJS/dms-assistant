import { DefaultDisplays, TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import type { TableViewSourceColumn } from "@antelopejs/interface-dms/base/table-view/source";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { I18N_SECTIONS } from "../../constants/i18n";
import { PAGE_IDS, PAGE_ORDER, PAGE_ROUTES } from "../../constants/pages";
import {
  EXCLUSION_STATUSES,
  i18nKey,
  vocabularyOptions,
  vocabularyTones,
} from "../../vocabulary";
import { blockMeta, pageMenu } from "../meta";

const SECTION = I18N_SECTIONS.EXCLUSIONS;

function text(...segments: string[]): string {
  return i18nKey(SECTION, ...segments);
}

const COLUMNS = {
  route: {
    name: text("columns", "route"),
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay(),
    sortable: true,
    order: 1,
  },
  covers: {
    name: text("columns", "covers"),
    type: new DefaultDataTypes.StringType(),
    order: 2,
  },
  fields: {
    name: text("columns", "fields"),
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.PillsDisplay(),
    order: 3,
  },
  status: {
    name: text("columns", "status"),
    type: new DefaultDataTypes.SelectType({
      items: vocabularyOptions(SECTION, "status", EXCLUSION_STATUSES),
    }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: vocabularyTones(EXCLUSION_STATUSES),
    }),
    order: 4,
  },
} satisfies Record<string, TableViewSourceColumn>;

const EDITOR = CustomComponent("DmsAiExclusionEditor").meta(
  blockMeta("exclusions.editor", "i-ph-eye-slash"),
);

/**
 * AI Exclusions — the data Analyst may never read, one list for the project:
 * one row per data route with its excluded fields, applied to every table
 * reading that route. A source table on `/ai/exclusions`; one dialog adds a
 * route, picked from the pages and tables the owner can see, or edits one.
 */
@RegisterPage()
export class AIExclusionsPage extends PageController(
  PAGE_IDS.EXCLUSIONS,
  pageMenu(PAGE_IDS.EXCLUSIONS, "i-ph-eye-slash", PAGE_ORDER.EXCLUSIONS),
  DefaultLayout(),
) {
  static entries = TableView.fromSource({
    fetchUrl: PAGE_ROUTES.EXCLUSIONS,
    columns: COLUMNS,
    labelKey: "route",
    searchPlaceholder: text("search"),
    defaultSort: { field: "route", desc: false },
    customButtons: [
      {
        label: text("add"),
        icon: "i-ph-plus",
        target: {
          type: "modal",
          component: EDITOR,
          title: text("add_title"),
          description: text("add_description"),
        },
      },
    ],
    rowActions: {
      custom: [
        {
          label: text("edit"),
          icon: "i-ph-pencil-simple",
          isDefault: true,
          isVisible: true,
          target: {
            type: "modal",
            component: EDITOR,
            title: text("edit_title"),
            description: text("add_description"),
          },
        },
        {
          label: text("remove"),
          icon: "i-ph-trash",
          isVisible: true,
          confirm: {
            title: text("remove_confirm", "title"),
            description: text("remove_confirm", "description"),
            confirmLabel: text("remove"),
          },
          target: {
            type: "api",
            url: PAGE_ROUTES.EXCLUSION_REMOVE,
            method: "DELETE",
            successMessage: text("removed"),
          },
        },
      ],
    },
    footer: { countLabel: text("count") },
    emptyStates: {
      firstRun: {
        title: text("empty", "title"),
        description: text("empty", "description"),
        icon: "i-ph-eye-slash",
      },
      error: {
        title: text("error", "title"),
        description: text("error", "description"),
        icon: "i-ph-warning",
      },
    },
  }).meta(blockMeta("exclusions.entries", "i-ph-eye-slash"));
}
