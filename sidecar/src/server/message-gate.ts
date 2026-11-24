import type { WebSocket } from "ws";
import { type AnyServerEventType, EVENT_TYPES } from "../protocol/events.js";
import {
  type AnyClientMessageType,
  MESSAGE_TYPES,
} from "../protocol/messages.js";
import {
  CLOSED_CONVERSATION_MESSAGES,
  isVisibleTo,
} from "../state/conversations.js";
import type { ConnectionContext } from "./services.js";

/** What the router runs for one parsed client message. */
export type ClientMessageHandler = (
  socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
) => void | Promise<void>;

/** A message that acts on the conversation it names. */
type ConversationMessageType = Extract<
  AnyClientMessageType,
  { conversationId: string }
>;

/** A message that answers a pending request by its id. */
type RequestAnswerType = Extract<
  ConversationMessageType,
  { requestId: string }
>;

type MessageOf<T extends AnyClientMessageType["type"]> = Extract<
  AnyClientMessageType,
  { type: T }
>;

type ConversationMessageOf<T extends ConversationMessageType["type"]> = Extract<
  ConversationMessageType,
  { type: T }
>;

function isMessageOf<T extends AnyClientMessageType["type"]>(
  msg: AnyClientMessageType,
  type: T,
): msg is MessageOf<T> {
  return msg.type === type;
}

function isConversationMessageOf<T extends ConversationMessageType["type"]>(
  msg: AnyClientMessageType,
  type: T,
): msg is ConversationMessageOf<T> {
  return msg.type === type;
}

/** Writes one server event to the socket. */
export function send(socket: WebSocket, event: AnyServerEventType): void {
  socket.send(JSON.stringify(event));
}

/** The `userId` the connection's actor frame named; null until there is one. */
export function viewerOf(ctx: ConnectionContext): string | null {
  return ctx.actor?.userId ?? null;
}

const FOREIGN_CONVERSATION_ERROR = "This conversation belongs to someone else.";
/**
 * Why the connection may not use the conversation: closed (set aside when the
 * store was read, or deleted), or not visible to the connection's actor. Null
 * when it may.
 */
export function refusalOf(
  ctx: ConnectionContext,
  conversationId: string,
): string | null {
  const closure = ctx.conversationStore.closure(conversationId);
  if (closure !== null) return CLOSED_CONVERSATION_MESSAGES[closure];
  const stored = ctx.conversationStore.get(conversationId);
  return stored !== null && !isVisibleTo(stored, viewerOf(ctx))
    ? FOREIGN_CONVERSATION_ERROR
    : null;
}

/** Refuses a request on a conversation the connection may not use; true when it may go on. */
function admit(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): boolean {
  const error = refusalOf(ctx, conversationId);
  if (error === null) return true;
  send(socket, { type: EVENT_TYPES.RUN_ERROR, conversationId, error });
  return false;
}

/** The conversation each request-id answer's pending request belongs to. */
const REQUEST_CONVERSATIONS = {
  [MESSAGE_TYPES.PERMISSION_RESPONSE]: (ctx, requestId) =>
    ctx.permissionBus.conversationOf(requestId),
  [MESSAGE_TYPES.QUESTION_RESPONSE]: (ctx, requestId) =>
    ctx.questionBus.conversationOf(requestId),
} satisfies {
  [T in RequestAnswerType["type"]]: (
    ctx: ConnectionContext,
    requestId: string,
  ) => string | undefined;
};

/**
 * Whether the message answers no request, or one pending on the conversation
 * it names. Any other answer gets no reply, like an unknown request, so the
 * sender cannot tell another conversation's request from no request.
 */
function answersOwnRequest(
  ctx: ConnectionContext,
  msg: ConversationMessageType,
): boolean {
  if (!("requestId" in msg)) return true;
  return (
    REQUEST_CONVERSATIONS[msg.type](ctx, msg.requestId) === msg.conversationId
  );
}

/**
 * A handler bound to one message type: others never reach it. A message on a
 * conversation goes through `onConversation` instead.
 */
export function on<
  T extends Exclude<
    AnyClientMessageType["type"],
    ConversationMessageType["type"]
  >,
>(
  type: T,
  handle: (
    socket: WebSocket,
    msg: MessageOf<T>,
    ctx: ConnectionContext,
  ) => void | Promise<void>,
): ClientMessageHandler {
  return (socket, msg, ctx) =>
    isMessageOf(msg, type) ? handle(socket, msg, ctx) : undefined;
}

/**
 * A handler bound to one message type on a conversation: it runs only once
 * the connection may use the conversation the message names (otherwise the
 * sender gets the refusal as a `run_error`), and, for an answer, once the
 * request is pending on that conversation.
 */
export function onConversation<T extends ConversationMessageType["type"]>(
  type: T,
  handle: (
    socket: WebSocket,
    msg: ConversationMessageOf<T>,
    ctx: ConnectionContext,
  ) => void | Promise<void>,
): ClientMessageHandler {
  return (socket, msg, ctx) => {
    if (!isConversationMessageOf(msg, type)) return;
    if (!admit(socket, ctx, msg.conversationId)) return;
    if (!answersOwnRequest(ctx, msg)) return;
    return handle(socket, msg, ctx);
  };
}
