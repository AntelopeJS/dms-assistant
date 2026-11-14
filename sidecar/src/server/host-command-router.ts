import type { AnyServerEventType } from "../protocol/events.js";
import type { ConversationStore } from "../state/conversations.js";
import type {
  HostSocketRegistry,
  SocketSender,
} from "./host-socket-registry.js";
import type { ChatSocketRegistry } from "./chat-socket-registry.js";

/** Sends a host command on behalf of one conversation. */
export type HostCommandSender = (event: AnyServerEventType) => void;

/** What the router reads to find the hosts of a conversation's owner. */
export interface HostCommandRouting {
  hosts: HostSocketRegistry;
  chats: ChatSocketRegistry;
  conversations: Pick<ConversationStore, "get">;
  /** The `userId` of each socket's actor. */
  viewers: WeakMap<SocketSender, string>;
}

/**
 * Routes a conversation's host commands to the tab that carries it, since a
 * tab's host and chat share one socket; the owner's latest host takes them
 * otherwise, never another person's.
 */
export function createHostCommandRouter(
  routing: HostCommandRouting,
): (conversationId: string) => HostCommandSender {
  return (conversationId) => (event) => {
    const owner = routing.conversations.get(conversationId)?.ownerId ?? null;
    routing.hosts.send(
      event,
      (socket) => (routing.viewers.get(socket) ?? null) === owner,
      routing.chats.socketOf(conversationId),
    );
  };
}
