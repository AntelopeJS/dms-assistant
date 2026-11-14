import {
  GENERATION_MODE_AGENT_NAMES,
  HOST_CONTEXT_BLOCK_LABEL,
  HOST_CONTEXT_CLOSE,
  HOST_CONTEXT_FILE_LABEL,
  HOST_CONTEXT_MOCKUP_SOURCE_LINE,
  HOST_CONTEXT_MODE_LABEL,
  HOST_CONTEXT_OPEN,
  HOST_CONTEXT_PAGE_LABEL,
  HOST_CONTEXT_TITLE_LABEL,
  HOST_CONTEXT_UNKNOWN_VALUE,
} from "../constants/agent.js";
import type { FocusBlockType } from "../protocol/messages.js";
import type { CurrentPage } from "../state/host-state.js";
import type { GenerationMode } from "../state/settings-types.js";

/** `mockup "bikes", page "home", path "grid.revenue", type "ChartCard"`: each value quoted, so none leaves the line. */
function describeFocusBlock(block: FocusBlockType): string {
  const parts = [
    `mockup ${JSON.stringify(block.mockup)}`,
    `page ${JSON.stringify(block.page)}`,
    `path ${JSON.stringify(block.path)}`,
  ];
  if (block.type !== undefined)
    parts.push(`type ${JSON.stringify(block.type)}`);
  return parts.join(", ");
}

export function formatHostContext(
  page: CurrentPage,
  mode: GenerationMode,
  focusBlock?: FocusBlockType,
): string {
  const lines = [
    `${HOST_CONTEXT_PAGE_LABEL}${page.path}`,
    `${HOST_CONTEXT_TITLE_LABEL}${page.title ?? HOST_CONTEXT_UNKNOWN_VALUE}`,
    `${HOST_CONTEXT_FILE_LABEL}${page.filepath ?? HOST_CONTEXT_UNKNOWN_VALUE}`,
    `${HOST_CONTEXT_MODE_LABEL}${GENERATION_MODE_AGENT_NAMES[mode]}`,
    HOST_CONTEXT_MOCKUP_SOURCE_LINE,
  ];
  if (focusBlock !== undefined)
    lines.push(`${HOST_CONTEXT_BLOCK_LABEL}${describeFocusBlock(focusBlock)}`);
  return `${HOST_CONTEXT_OPEN}\n${lines.join("\n")}\n${HOST_CONTEXT_CLOSE}`;
}

export function prependHostContext(
  message: string,
  page: CurrentPage,
  mode: GenerationMode,
  focusBlock?: FocusBlockType,
): string {
  return `${formatHostContext(page, mode, focusBlock)}\n\n${message}`;
}
