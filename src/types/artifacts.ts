import type { JsonBody } from "../sidecar/json-body";

/** An artifact as the sidecar lists it: its record without its blocks. */
export interface ArtifactSummary {
  id: string;
  conversationId: string;
  ownerId?: string;
  createdBy?: string;
  agent: string;
  createdAtMs: number;
  kind: string;
  title: string;
  summary?: string;
  blocks: number;
}

/** An artifact as the Artifacts table reads it. */
export interface ArtifactTableRow extends ArtifactSummary {
  _id: string;
  createdAt: string;
}

/**
 * One artifact with its data. The route forwards `spec` as the sidecar wrote
 * it: the dashboard reads it with the spec schema before it draws anything.
 */
export interface ArtifactPayload extends Omit<
  ArtifactSummary,
  "title" | "summary" | "blocks"
> {
  spec: JsonBody;
}
