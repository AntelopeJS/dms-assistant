import type { AnyMcpToolDefinition } from "./define-tool.js";
import { buildAskUserTool } from "./tools/ask-user.js";
import { buildFindPagesUsingTool } from "./tools/find-pages-using.js";
import { buildGetCurrentPageTool } from "./tools/get-current-page.js";
import { buildNavigateToPageTool } from "./tools/navigate-to-page.js";
import { buildPreviewBlocksTool } from "./tools/preview-blocks.js";
import type { AiMcpServerDeps } from "./types.js";

/**
 * The chat's own tools: the ones that drive the user's tab or the chat itself.
 * Every other tool comes from the DMS MCP server.
 */
export function buildToolDefinitions(
  deps: AiMcpServerDeps,
): AnyMcpToolDefinition[] {
  return [
    buildGetCurrentPageTool(deps.getCurrentPage),
    buildFindPagesUsingTool({
      registry: deps.registry,
      scanner: deps.scanner,
      hostProjectRoot: deps.hostProjectRoot,
      getCurrentPage: deps.getCurrentPage,
    }),
    buildNavigateToPageTool({
      sendToHost: deps.sendToHost,
      navigationCompleter: deps.navigationCompleter,
      registry: deps.registry,
      getCurrentPage: deps.getCurrentPage,
    }),
    buildAskUserTool({
      conversationId: deps.conversationId,
      requestQuestion: deps.requestQuestion,
    }),
    buildPreviewBlocksTool({
      showPreview: deps.showPreview,
      listAttachedImages: deps.listAttachedImages,
    }),
  ];
}
