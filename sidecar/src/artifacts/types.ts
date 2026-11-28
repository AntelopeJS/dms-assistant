import type { ArtifactKind } from "../constants/artifacts.js";
import type { ProviderName } from "../state/types.js";
import type { ArtifactSpec } from "./spec.js";

/** An artifact as `artifacts.json` holds it: who made it, from which conversation, and its data. */
export interface ArtifactRecord {
  id: string;
  conversationId: string;
  /**
   * The `userId` of the conversation's owner when the artifact was saved, who
   * alone sees it; absent when the conversation had no owner, like
   * `StoredConversation.ownerId`.
   */
  ownerId?: string;
  /** The name of the person whose request produced it, when known. */
  createdBy?: string;
  agent: ProviderName;
  createdAtMs: number;
  kind: ArtifactKind;
  spec: ArtifactSpec;
}

/** What a list of artifacts shows of one: the record without its blocks. */
export interface ArtifactSummary extends Omit<ArtifactRecord, "spec"> {
  title: string;
  summary?: string;
  blocks: number;
}

export function summarizeArtifact(record: ArtifactRecord): ArtifactSummary {
  const { spec, ...rest } = record;
  const summary: ArtifactSummary = {
    ...rest,
    title: spec.title,
    blocks: spec.blocks.length,
  };
  if (spec.summary !== undefined) summary.summary = spec.summary;
  return summary;
}

/**
 * Whether `viewerId` (null: a connection that named no actor) may see the
 * artifact: the owner of the conversation it came from. An artifact of a
 * conversation without an owner is open to a connection that named no actor
 * alone, as `isVisibleTo` reads such a conversation.
 */
export function isArtifactVisibleTo(
  record: ArtifactRecord,
  viewerId: string | null,
): boolean {
  if (record.ownerId !== undefined) return record.ownerId === viewerId;
  return viewerId === null;
}
