import { join } from "node:path";
import type { JsonValue } from "../../src/protocol/json.js";
import {
  MESSAGE_TYPES,
  type PermissionRuleType,
} from "../../src/protocol/messages.js";

export const WAIT_MS = 5_000;
export const SETTLE_MS = 250;
export const TEST_TIMEOUT_MS = WAIT_MS * 4;
export const CAMILLE = { userId: "u-camille", name: "Camille" };
export const DANA = { userId: "u-dana", name: "Dana" };
export const CONVERSATION = "conv-camille";
export const CAMILLE_PAGE = "/camille-orders";
export const CAMILLE_REPORT_PAGE = "/camille-reports";
export const DANA_PAGE = "/dana-customers";
export const REFUSAL = "This conversation belongs to someone else.";
export const CAMILLE_TEXT = "camille's private request";
export const EDITED_FILE = join("src", "pages", "index.vue");
export const QUESTION = {
  question: "Which table?",
  header: "Table",
  options: [
    { label: "orders", description: "The orders table" },
    { label: "customers", description: "The customers table" },
  ],
};

/** A frame the chat socket carries, as the wire writes it. */
export type Frame = { [key: string]: JsonValue | undefined };

/**
 * What Camille's conversation holds when Dana acts: `paused` is a turn waiting
 * on a permission prompt with a question and a queued follow-up pending;
 * `settled` is a finished turn that left a change set and a standing rule.
 */
export type WorldKind = "paused" | "settled";

/** The ids of what a world created, which an answer or an action names. */
export interface World {
  kind: WorldKind;
  requestId: string;
  ruleOption: PermissionRuleType;
  ruleId: string;
  questionId: string;
  changeSetId: string;
}

/**
 * What a client message does to a conversation it does not own. Each variant
 * is one frame Dana sends. `none` types carry no conversation and no request
 * id, so ownership cannot apply to them, and say why.
 */
export interface SentScope {
  kind: "send";
  world: WorldKind;
  frames: (world: World) => Frame[];
  /** A defect of the code today: the case is expected to fail until it is fixed. */
  defect?: string;
}

export type Scope = { kind: "none"; why: string } | SentScope;

const ON_CONVERSATION = { conversationId: CONVERSATION } as const;

/**
 * Every message type a client may send, exactly one entry each, so a new type
 * fails the typecheck until it is classified here.
 */
export const SCOPES: Record<
  Exclude<(typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES], "echo_reply">,
  Scope
> = {
  hello: {
    kind: "send",
    world: "paused",
    frames: () => [
      { type: "hello", role: "chat", ...ON_CONVERSATION },
      { type: "hello", role: "chat", follow: true, ...ON_CONVERSATION },
      { type: "hello", role: "host" },
    ],
  },
  echo: { kind: "none", why: "echoes the payload and touches nothing else" },
  reload_hold_applied: {
    kind: "none",
    why: "answers the module's reload host about the dev watcher, and touches no conversation",
  },
  actor: {
    kind: "none",
    why: "names the connection's actor: the DMS backend asserts identity over its own credential, not the browser",
  },
  user_message: {
    kind: "send",
    world: "settled",
    frames: () => [
      { type: "user_message", content: "take over", ...ON_CONVERSATION },
    ],
  },
  retry_turn: {
    kind: "send",
    world: "settled",
    frames: () => [{ type: "retry_turn", ...ON_CONVERSATION }],
  },
  permission_response: {
    kind: "send",
    world: "paused",
    frames: (world) => [
      {
        type: "permission_response",
        requestId: world.requestId,
        decision: "allow_rule",
        rule: world.ruleOption,
        conversationId: "anything",
      },
      {
        type: "permission_response",
        requestId: world.requestId,
        decision: "allow_once",
        conversationId: CONVERSATION,
      },
      {
        type: "permission_response",
        requestId: world.requestId,
        decision: "deny_all",
        conversationId: "anything",
      },
    ],
  },
  question_response: {
    kind: "send",
    world: "paused",
    frames: (world) => [
      {
        type: "question_response",
        requestId: world.questionId,
        answers: ["orders"],
        conversationId: "anything",
      },
    ],
  },
  host_state_update: {
    kind: "send",
    world: "paused",
    frames: () => [
      { type: "host_state_update", currentPage: { path: DANA_PAGE } },
    ],
  },
  host_navigation_complete: {
    kind: "send",
    world: "paused",
    frames: () => [{ type: "host_navigation_complete", path: CAMILLE_PAGE }],
  },
  host_page_blocks: {
    kind: "send",
    world: "paused",
    frames: () => [
      {
        type: "host_page_blocks",
        path: CAMILLE_REPORT_PAGE,
        status: "settled",
        checked: 0,
        blocks: [],
      },
    ],
  },
  list_conversations: {
    kind: "send",
    world: "settled",
    frames: () => [{ type: "list_conversations" }],
  },
  delete_conversation: {
    kind: "send",
    world: "settled",
    frames: () => [{ type: "delete_conversation", ...ON_CONVERSATION }],
  },
  set_settings: {
    kind: "none",
    why: "changes the settings every conversation shares, which belong to no conversation owner",
  },
  interrupt_turn: {
    kind: "send",
    world: "paused",
    frames: () => [{ type: "interrupt_turn", ...ON_CONVERSATION }],
  },
  queue_enqueue: {
    kind: "send",
    world: "paused",
    frames: () => [
      {
        type: "queue_enqueue",
        item: { id: "dana-item", content: "dana's follow-up" },
        ...ON_CONVERSATION,
      },
    ],
  },
  queue_cancel: {
    kind: "send",
    world: "paused",
    frames: () => [{ type: "queue_cancel", id: "item-1", ...ON_CONVERSATION }],
  },
  queue_update: {
    kind: "send",
    world: "paused",
    frames: () => [
      {
        type: "queue_update",
        id: "item-1",
        content: "changed",
        ...ON_CONVERSATION,
      },
    ],
  },
  queue_move: {
    kind: "send",
    world: "paused",
    frames: () => [
      { type: "queue_move", id: "item-1", toIndex: 0, ...ON_CONVERSATION },
    ],
  },
  queue_clear: {
    kind: "send",
    world: "paused",
    frames: () => [{ type: "queue_clear", ...ON_CONVERSATION }],
  },
  revoke_rule: {
    kind: "send",
    world: "settled",
    frames: (world) => [
      {
        type: "revoke_rule",
        ruleId: world.ruleId,
        ...ON_CONVERSATION,
      },
    ],
  },
  set_conversation_mode: {
    kind: "send",
    world: "paused",
    frames: () => [
      {
        type: "set_conversation_mode",
        mode: "plan",
        generationMode: "vibe",
        ...ON_CONVERSATION,
      },
    ],
  },
  stop_autofix: {
    kind: "send",
    world: "paused",
    frames: () => [{ type: "stop_autofix", ...ON_CONVERSATION }],
  },
  change_set_action: {
    kind: "send",
    world: "settled",
    frames: (world) => [
      {
        type: "change_set_action",
        changeSetId: world.changeSetId,
        action: "undo",
        ...ON_CONVERSATION,
      },
      {
        type: "change_set_action",
        changeSetId: world.changeSetId,
        action: "undo",
      },
    ],
  },
};
