import { DATABASE_TOOL_NAMES } from "./database.js";
import {
  BUILDER_TOOL_NAMES,
  MOCKUP_TOOL_NAMES,
  PAGE_VERIFY_TOOL_NAME,
} from "./builder.js";
import { QUERY_LOGS_TOOL_NAME } from "./logs.js";
import { FIND_PAGES_TOOL_NAME, LIST_PAGES_TOOL_NAME } from "./pages.js";
import { PREVIEW_BLOCKS_TOOL_NAME } from "./preview.js";
import { REQUEST_TIMEOUT_MINUTES } from "../state/settings-types.js";
import { QUESTION_TIMEOUT_MS } from "./questions.js";
import { MS_PER_MINUTE } from "./settings.js";
import { TYPECHECK_TOOL_NAME } from "./typecheck.js";

export const MCP_SERVER_NAME = "dms-ai-mcp";
export const MCP_SERVER_VERSION = "0.0.1";
export const MCP_SERVER_KEY = "dms-ai";
export const MCP_SERVER_TYPE_SDK = "sdk" as const;

/**
 * The SDK exposes MCP tools to the model as mcp__<serverKey>__<toolName>.
 */
export const MCP_TOOL_NAME_PREFIX = `mcp__${MCP_SERVER_KEY}__`;

/** The DMS MCP server of `@antelopejs/dms`: its key in `.mcp.json`, and so its tools' prefix. */
export const DMS_MCP_SERVER_KEY = "dms";
export const DMS_MCP_TOOL_NAME_PREFIX = `mcp__${DMS_MCP_SERVER_KEY}__`;
/**
 * The `code` of the JSON text block the DMS MCP ends its answer with when it
 * holds a call until someone confirms it. The DMS runs an identical call
 * repeated within `DMS_MCP_HOLD_WINDOW_MS` in the same session.
 */
export const DMS_MCP_HOLD_CODE = "confirmation_required";
/**
 * How the prose of that answer continues after the tool's name: read only
 * when an answer carries no code, as a DMS released before the code sends.
 */
export const DMS_MCP_HOLD_REFUSAL_SUFFIX =
  " was not run: no one has confirmed it yet.";
/** How the line of that answer that holds the DMS's preview of the call, as JSON, starts. */
export const DMS_MCP_HOLD_PREVIEW_PREFIX =
  "Its arguments, with what the builder previewed: ";
export const DMS_MCP_HOLD_WINDOW_MS = 10 * MS_PER_MINUTE;
/** How `.mcp.json` starts the DMS MCP server: `node` on the stdio launcher the DMS writes under the project root. */
export const DMS_MCP_COMMAND = "node";
export const DMS_MCP_LAUNCHER_PATH = [
  "node_modules",
  ".cache",
  "dms",
  "mcp-bridge.cjs",
] as const;

export const GET_CURRENT_PAGE_TOOL_NAME = "get_current_page";
export const GET_CURRENT_PAGE_TOOL_DESCRIPTION =
  "Returns the route and, when known, the title and source file of the page currently displayed in the host browser.";

export const NAVIGATE_TOOL_NAME = "navigate_to_page";
export const NAVIGATE_TOOL_DESCRIPTION =
  "Navigates the host browser to the given path using the host router. Awaits a host navigation-complete confirmation (with a short timeout fallback). Then waits for the page's data blocks to settle and lists those that are empty, failed or still loading under `data.blocks`: a page with such blocks is not done. Call get_current_page to verify if needed.";
export const NAVIGATE_RESULT_PREFIX = "Navigation requested to ";
export const NAVIGATE_RESULT_COMPLETED_SUFFIX = " (completed)";
export const NAVIGATE_RESULT_TIMEOUT_SUFFIX =
  " (timed out waiting for confirmation)";
/**
 * Appended to the navigate result so the agent gets grounded confirmation of the
 * page the host is actually on now, rather than assuming the requested path took.
 */
export const NAVIGATE_RESULT_LANDED_PREFIX = ". Host is now displaying ";

/**
 * Returned instead of navigating when the requested path matches no registered
 * route — stops the agent from landing on a guessed URL that 404s.
 */
export const NAVIGATE_UNKNOWN_ROUTE_PREFIX = "Did not navigate: ";
export const NAVIGATE_UNKNOWN_ROUTE_SUFFIX =
  " is not a registered page route. Closest known routes: ";
export const NAVIGATE_UNKNOWN_ROUTE_HINT = `. Call ${DMS_MCP_TOOL_NAME_PREFIX}${LIST_PAGES_TOOL_NAME} for the full list and use a real route.`;
/**
 * Cap the number of suggested routes inlined into the tool result.
 */
export const NAVIGATE_SUGGESTION_LIMIT = 20;

export const ASK_USER_TOOL_NAME = "ask_user";
export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user one or more multiple-choice questions and wait for their answer. Use this whenever you need a decision or clarification instead of asking in prose. Provide 1-4 questions, each with 2-4 distinct options ({label, description}); the user may also type a custom answer. Returns the user's chosen answer for each question.";
export const ASK_USER_RESULT_PREFIX = "User answered:";
export const ASK_USER_RESULT_SKIPPED =
  "The user skipped this question and lets you decide.";
export const ASK_USER_RESULT_NO_ANSWER =
  "The user did not answer (the question timed out or was dismissed).";

/**
 * The SDK's built-in AskUserQuestion tool cannot render in the chat, so
 * calls to it dead-end at the permission prompt. Redirect the agent to the
 * module's own ask_user MCP tool, which routes to the question bus the chat
 * does render.
 */
export const ASK_USER_QUESTION_BUILTIN_TOOL_NAME = "AskUserQuestion";
export const ASK_USER_QUESTION_REDIRECT_MESSAGE = `AskUserQuestion is not available here. Use the ${MCP_TOOL_NAME_PREFIX}${ASK_USER_TOOL_NAME} tool instead to ask the user multiple-choice questions.`;

/**
 * The DMS MCP's tools that the chat serves itself, since only the chat's own
 * drive the user's tab and the chat. Hidden, so the agent sees one of each.
 */
export const DMS_MCP_HIDDEN_TOOL_NAMES: readonly string[] = [
  NAVIGATE_TOOL_NAME,
  PREVIEW_BLOCKS_TOOL_NAME,
];

const CHAT_TOOL_NAMES: readonly string[] = [
  ASK_USER_TOOL_NAME,
  GET_CURRENT_PAGE_TOOL_NAME,
  FIND_PAGES_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
  PREVIEW_BLOCKS_TOOL_NAME,
];

const DMS_MCP_AUTO_ALLOW_TOOL_NAMES: readonly string[] = [
  ...BUILDER_TOOL_NAMES,
  ...DATABASE_TOOL_NAMES,
  TYPECHECK_TOOL_NAME,
  QUERY_LOGS_TOOL_NAME,
  LIST_PAGES_TOOL_NAME,
  ...MOCKUP_TOOL_NAMES,
  PAGE_VERIFY_TOOL_NAME,
];

/**
 * Explicit allowlist of the MCP tools the chat runs without a permission
 * prompt, by the fully qualified name the agent sees. The DMS MCP itself holds
 * its risky calls for a repeated confirmation. A tool outside this set, a new
 * one included, still asks.
 */
export const FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...CHAT_TOOL_NAMES.map((name) => `${MCP_TOOL_NAME_PREFIX}${name}`),
  ...DMS_MCP_AUTO_ALLOW_TOOL_NAMES.map(
    (name) => `${DMS_MCP_TOOL_NAME_PREFIX}${name}`,
  ),
]);

export const MCP_HTTP_PATH = "/mcp";
/**
 * Where an out-of-process provider reaches the endpoint above.
 */
export const MCP_HTTP_URL_TEMPLATE = `http://127.0.0.1:%port%${MCP_HTTP_PATH}`;
export const MCP_HTTP_PORT_TOKEN = "%port%";
export const MCP_AUTHORIZATION_HEADER = "authorization";
export const MCP_BEARER_PREFIX = "bearer ";
/**
 * Loopback forms accepted in Host/Origin. Anything else is refused so a page in
 * a browser cannot reach the sidecar's MCP endpoint by DNS rebinding.
 */
export const MCP_LOOPBACK_HOSTNAMES = [
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
];

const MS_PER_SECOND = 1_000;

const LONGEST_USER_WAIT_MS = Math.max(
  QUESTION_TIMEOUT_MS,
  Math.max(...REQUEST_TIMEOUT_MINUTES) * MS_PER_MINUTE,
);

const MCP_TOOL_TIMEOUT_GRACE_MS = 5 * MS_PER_MINUTE;

/**
 * How long a provider lets one MCP tool call run, on both servers. It must
 * outlast every wait on the user, or the provider abandons a call whose card is
 * still on screen.
 */
export const MCP_TOOL_TIMEOUT_MS =
  LONGEST_USER_WAIT_MS + MCP_TOOL_TIMEOUT_GRACE_MS;
export const MCP_TOOL_TIMEOUT_SEC = MCP_TOOL_TIMEOUT_MS / MS_PER_SECOND;
