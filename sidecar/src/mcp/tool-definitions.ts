import type { AnyMcpToolDefinition } from "./define-tool.js";
import { buildAskUserTool } from "./tools/ask-user.js";
import { buildFindPagesUsingTool } from "./tools/find-pages-using.js";
import { buildGetCurrentPageTool } from "./tools/get-current-page.js";
import { buildNavigateToPageTool } from "./tools/navigate-to-page.js";
import type { AiMcpServerDeps } from "./types.js";

/**
 * The tools of the chat's own `dms-assistant` MCP server. Every other MCP tool the
 * agent sees comes from the DMS MCP server.
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
      waitForLanding: deps.waitForLanding,
      registry: deps.registry,
      getCurrentPage: deps.getCurrentPage,
    }),
    buildAskUserTool({
      conversationId: deps.conversationId,
      requestQuestion: deps.requestQuestion,
    }),
  ];
}
