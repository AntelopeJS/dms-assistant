import type { CurrentPage } from "../state/host-state.js";
import type { SidecarServices } from "./services.js";

/**
 * The page the conversation owner's dashboard shows: a turn, and the tools it
 * calls, read the page of the person who asked, never another person's.
 */
export function pageOf(
  services: Pick<SidecarServices, "conversationStore" | "hostState">,
  conversationId: string,
): CurrentPage {
  const owner = services.conversationStore.get(conversationId)?.ownerId ?? null;
  return services.hostState.getCurrentPage(owner);
}
