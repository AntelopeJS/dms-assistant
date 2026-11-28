import { randomUUID } from "node:crypto";
import type { SidecarServices } from "../server/services.js";
import { type ArtifactSpec, artifactKindOf } from "./spec.js";
import type { ArtifactRecord } from "./types.js";

/** What saving an artifact reads: the store, and the conversation it is attached to. */
export type ArtifactSaver = Pick<
  SidecarServices,
  "artifacts" | "conversationStore" | "askers" | "settingsStore"
>;

/**
 * Records an artifact of a conversation: owned by the conversation's owner,
 * stamped with who asked and which agent answered, then stored.
 */
export function saveArtifact(
  services: ArtifactSaver,
  conversationId: string,
  spec: ArtifactSpec,
): ArtifactRecord {
  const conversation = services.conversationStore.get(conversationId);
  const record: ArtifactRecord = {
    id: randomUUID(),
    conversationId,
    agent: conversation?.provider ?? services.settingsStore.get().provider,
    createdAtMs: Date.now(),
    kind: artifactKindOf(spec),
    spec,
  };
  if (conversation?.ownerId !== undefined)
    record.ownerId = conversation.ownerId;
  const createdBy = services.askers.get(conversationId);
  if (createdBy !== undefined) record.createdBy = createdBy;
  services.artifacts.add(record);
  return record;
}
