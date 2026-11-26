import type { ChangeSetActionMsgType } from "../protocol/messages.js";
import type { ChangeSetRecord } from "../state/types.js";
import { broadcastConversationList } from "./chat-events.js";
import type { SidecarServices } from "./services.js";
import { sendChangeSet } from "./turns.js";

type ChangeSetAction = ChangeSetActionMsgType["action"];

export interface ChangeSetActionRequest {
  changeSetId: string;
  action: ChangeSetAction;
  includeLater?: boolean;
}

/**
 * Who asks for the action: the name the change sets record, and the
 * conversations whose later change sets an undo may take along.
 */
export interface ChangeSetSender {
  name: string | undefined;
  mayUse(conversationId: string): boolean;
}

type ActionRunner = (
  services: SidecarServices,
  request: ChangeSetActionRequest,
  sender: ChangeSetSender,
) => Promise<ChangeSetRecord[]>;

const ACTION_RUNNERS: Record<ChangeSetAction, ActionRunner> = {
  undo: (services, request, sender) =>
    services.checkpoints.undo(
      request.changeSetId,
      (later) =>
        request.includeLater === true && sender.mayUse(later.conversationId),
      sender.name,
    ),
  redo: (services, request, sender) =>
    services.checkpoints.redo(request.changeSetId, sender.name),
};

/**
 * Undoes or redoes a change set (and, for an undo, the later ones that
 * conflict with it on conversations the sender may use, when asked), then
 * tells every chat showing an affected conversation. Answers the ids it
 * changed.
 */
export async function handleChangeSetAction(
  services: SidecarServices,
  request: ChangeSetActionRequest,
  sender: ChangeSetSender,
): Promise<string[]> {
  const changed = await ACTION_RUNNERS[request.action](
    services,
    request,
    sender,
  );
  for (const record of changed) sendChangeSet(services, record);
  broadcastConversationList(services);
  return changed.map((record) => record.id);
}
