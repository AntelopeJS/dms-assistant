import type { BlockText } from "@antelopejs/interface-dms/base/types";

/** One point of a chart series. */
export interface SeriesPoint {
  x: string;
  y: number;
}

/** A named chart series. */
export interface NamedSeries {
  name: string;
  data: SeriesPoint[];
}

/** What a `ChartCard` reads. */
export interface ChartPayload {
  value: number;
  /** Absent without a comparison period, or when it counted zero. */
  delta?: number;
  /** Absent without a comparison period. */
  previousValue?: number;
  series: NamedSeries[];
  comparisonSeries?: NamedSeries[];
}

/** Tokens of one day. */
export interface UsageDay {
  day: string;
  totalTokens: number;
}

/** The conversation that used the most tokens. */
interface UsageTopConversation {
  conversationId: string;
  title: string;
  totalTokens: number;
}

/** Tokens used per day over a window. */
export interface UsageReport {
  days: UsageDay[];
  totalTokens: number;
  conversations: number;
  top?: UsageTopConversation;
}

/** One row of a `KeyValueList`. */
export interface KeyValueItem {
  id: string;
  label: string;
  value: string | number | null;
  type?: string;
  /** Composed in the reader's language when it names a count. */
  detail?: BlockText;
}
