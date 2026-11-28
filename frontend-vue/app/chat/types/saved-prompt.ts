/**
 * A prompt the member saved under a name, as `/ai/prompts` lists it. It is
 * theirs alone: the backend stamps the owner from the session.
 */
export interface SavedPrompt {
	id: string;
	ownerId: string;
	name: string;
	text: string;
	createdAtMs: number;
	updatedAtMs: number;
}
