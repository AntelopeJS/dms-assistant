import type { CurrentPage } from "../state/host-state.js";
import type { SidecarServices } from "./services.js";

/** The `userId` of the conversation's owner, null for a conversation without one. */
export function ownerOf(
  services: Pick<SidecarServices, "conversationStore">,
  conversationId: string,
): string | null {
  return services.conversationStore.get(conversationId)?.ownerId ?? null;
}

/**
 * The page the conversation owner's dashboard shows: a turn, and the tools it
 * calls, read the page of the person who asked, never another person's.
 */
export function pageOf(
  services: Pick<SidecarServices, "conversationStore" | "hostState">,
  conversationId: string,
): CurrentPage {
  return services.hostState.getCurrentPage(ownerOf(services, conversationId));
}
