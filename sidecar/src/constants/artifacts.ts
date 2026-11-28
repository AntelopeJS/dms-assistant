export const ARTIFACTS_FILE_NAME = "artifacts.json";
export const ARTIFACTS_LOG_PREFIX = "[dms-assistant artifacts]";

export const CREATE_ARTIFACT_TOOL_NAME = "create_artifact";
export const CREATE_ARTIFACT_TOOL_DESCRIPTION =
  "Saves an artifact: a report, a table or a chart of your results that the user opens in the dashboard, now and later. Give it a title and structured blocks (heading, paragraph, list, kpis, table, chart); the dashboard draws them itself and shows every text literally, so write plain text, never HTML or Markdown. Use it when the user asks for a report, a table, a comparison or a chart they may want to keep, or when your answer is mostly figures. Returns the saved artifact's id and the dashboard path that opens it.";
export const CREATE_ARTIFACT_RESULT_PREFIX = "Artifact saved: ";
export const CREATE_ARTIFACT_RESULT_HINT =
  "End your reply with a Markdown link to that path, so the user can open it from the chat.";

/** The dashboard page that lists the artifacts; `?artifact=<id>` opens one. */
export const ARTIFACTS_PAGE_PATH = "/modules/ai/artifacts";
export const ARTIFACT_QUERY_PARAM = "artifact";

/** What one artifact may hold: enough for a report, bounded so one call cannot fill the store or the page. */
export const ARTIFACT_LIMITS = {
  TITLE_CHARS: 120,
  SUMMARY_CHARS: 600,
  TEXT_CHARS: 200,
  PARAGRAPH_CHARS: 4000,
  CELL_CHARS: 400,
  LABEL_CHARS: 80,
  BLOCKS: 40,
  KPIS: 8,
  COLUMNS: 20,
  ROWS: 500,
  LIST_ITEMS: 100,
  SERIES: 6,
  POINTS: 200,
} as const;

/** How an artifact is listed: by the data block it is made of, else a report. */
export const ARTIFACT_KINDS = ["report", "table", "chart"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_CHART_KINDS = ["bar", "line"] as const;
export const ARTIFACT_TONES = [
  "neutral",
  "success",
  "warning",
  "error",
  "info",
] as const;
export const ARTIFACT_ALIGNMENTS = ["left", "right"] as const;

export const UNKNOWN_ARTIFACT_MESSAGE = "Unknown artifact.";
