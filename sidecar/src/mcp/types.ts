import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  QuestionAnswers,
  QuestionRequest,
} from "../agent/question-bus.js";
import type { MCP_SERVER_TYPE_SDK } from "../constants/mcp.js";
import type { ImportsScanner } from "../pages/imports-scanner.js";
import type { RegistryClient } from "../pages/registry-client.js";
import type { AnyServerEventType } from "../protocol/events.js";
import type { BlockPreviewType } from "../protocol/preview.js";
import type { NavigationCompleter } from "../server/navigation-completer.js";
import type { CurrentPage } from "../state/host-state.js";

/** Deps shared by every conversation's MCP server. Assembled once at startup. */
export interface AiMcpServerStaticDeps {
  registry: RegistryClient;
  scanner: ImportsScanner;
  hostProjectRoot: string;
  navigationCompleter: NavigationCompleter;
}

/**
 * The MCP server is built per conversation so conversation-scoped tools (ask_user)
 * can route to the right chat — the SDK does not pass our conversationId to tool
 * handlers, so we bind it here at construction instead.
 */
export interface AiMcpServerDeps extends AiMcpServerStaticDeps {
  conversationId: string;
  /** The page the conversation owner's dashboard shows. */
  getCurrentPage: () => CurrentPage;
  sendToHost: (event: AnyServerEventType) => void;
  requestQuestion: (req: QuestionRequest) => Promise<QuestionAnswers>;
  showPreview: (preview: BlockPreviewType) => void;
  listAttachedImages: () => string[];
}

/**
 * The in-process server handed to the Claude SDK. Described locally with the MCP
 * SDK's own server type, so the MCP layer carries no provider type and the
 * Claude binding accepts it as its SDK server config.
 */
export interface AiMcpServer {
  type: typeof MCP_SERVER_TYPE_SDK;
  name: string;
  instance: McpServer;
}
