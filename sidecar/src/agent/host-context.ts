import {
  GENERATION_MODE_AGENT_NAMES,
  HOST_CONTEXT_CLOSE,
  HOST_CONTEXT_FILE_LABEL,
  HOST_CONTEXT_MODE_LABEL,
  HOST_CONTEXT_OPEN,
  HOST_CONTEXT_PAGE_LABEL,
  HOST_CONTEXT_TITLE_LABEL,
  HOST_CONTEXT_UNKNOWN_VALUE,
} from "../constants/agent.js";
import { UNKNOWN_PAGE_PATH } from "../constants/host-state.js";
import type { CurrentPage } from "../state/host-state.js";
import type { GenerationMode } from "../state/settings-types.js";

export function formatHostContext(
  page: CurrentPage,
  mode: GenerationMode,
): string {
  const lines = [
    `${HOST_CONTEXT_PAGE_LABEL}${page.path}`,
    `${HOST_CONTEXT_TITLE_LABEL}${page.title ?? HOST_CONTEXT_UNKNOWN_VALUE}`,
    `${HOST_CONTEXT_FILE_LABEL}${page.filepath ?? HOST_CONTEXT_UNKNOWN_VALUE}`,
    `${HOST_CONTEXT_MODE_LABEL}${GENERATION_MODE_AGENT_NAMES[mode]}`,
  ];
  return `${HOST_CONTEXT_OPEN}\n${lines.join("\n")}\n${HOST_CONTEXT_CLOSE}`;
}

export function prependHostContext(
  message: string,
  page: CurrentPage,
  mode: GenerationMode,
): string {
  return `${formatHostContext(page, mode)}\n\n${message}`;
}

const NO_PAGE_PATHS: ReadonlySet<string> = new Set([
  HOST_CONTEXT_UNKNOWN_VALUE,
  UNKNOWN_PAGE_PATH,
]);

/**
 * Analyst's host-context block: the page's path and, when known, its title.
 * Undefined for no page: the user removed the page chip, or the host never
 * reported one.
 */
export function formatAnalystPageContext(
  page: CurrentPage,
): string | undefined {
  if (NO_PAGE_PATHS.has(page.path)) return undefined;
  const lines = [`${HOST_CONTEXT_PAGE_LABEL}${page.path}`];
  if (page.title !== undefined) {
    lines.push(`${HOST_CONTEXT_TITLE_LABEL}${page.title}`);
  }
  return `${HOST_CONTEXT_OPEN}\n${lines.join("\n")}\n${HOST_CONTEXT_CLOSE}`;
}

/** An Analyst turn's text: the page block above the message, when there is a page. */
export function groundAnalystTurn(message: string, page: CurrentPage): string {
  const block = formatAnalystPageContext(page);
  return block === undefined ? message : `${block}\n\n${message}`;
}
