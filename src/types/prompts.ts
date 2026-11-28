/**
 * A prompt a member saved under a name, as the sidecar holds it. It belongs
 * to the member (`ownerId`, their DMS user id), as a conversation does.
 */
export interface SavedPrompt {
  id: string;
  ownerId: string;
  name: string;
  text: string;
  createdAtMs: number;
  updatedAtMs: number;
}

/** What the sidecar answers once a prompt is deleted. */
export interface DeletedPrompt {
  deleted: string;
}
