/** The bounds of a saved prompt, as the sidecar's `constants/saved-prompts.ts` has them. */
export const SAVED_PROMPT_NAME_MAX_LENGTH = 80;
export const SAVED_PROMPT_TEXT_MAX_LENGTH = 20_000;

/** The sidecar's refusal code when the member already has a prompt of that name. */
export const DUPLICATE_PROMPT_NAME_CODE = "duplicate_name";
/** The module's refusal code for a body it does not accept. */
export const INVALID_PROMPT_CODE = "invalid";
