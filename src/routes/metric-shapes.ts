import { I18N_SECTIONS } from "../constants/i18n";
import type { ChartPayload, KeyValueItem, UsageReport } from "../types";
import { i18nKey } from "../vocabulary";

const SETTINGS = I18N_SECTIONS.SETTINGS;

/** Tokens per day, as a column chart reads them. */
export function usageChartPayload(report: UsageReport): ChartPayload {
  return {
    value: report.totalTokens,
    series: [
      {
        name: i18nKey(SETTINGS, "usage", "series"),
        data: report.days.map((day) => ({ x: day.day, y: day.totalTokens })),
      },
    ],
  };
}

/** The window's totals: tokens, conversations, and the biggest one. */
export function usageSummaryPayload(report: UsageReport) {
  const items: KeyValueItem[] = [
    {
      id: "tokens",
      label: i18nKey(SETTINGS, "usage", "total_tokens"),
      value: report.totalTokens,
      type: "mono",
    },
    {
      id: "conversations",
      label: i18nKey(SETTINGS, "usage", "conversations"),
      value: report.conversations,
      type: "mono",
    },
  ];
  if (report.top) {
    items.push({
      id: "top",
      label: i18nKey(SETTINGS, "usage", "top_conversation"),
      value: report.top.title,
      detail: {
        key: i18nKey(SETTINGS, "usage", "top_tokens"),
        params: { count: { type: "count", value: report.top.totalTokens } },
      },
    });
  }
  return { items };
}
