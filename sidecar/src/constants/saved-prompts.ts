export const SAVED_PROMPTS_FILE_NAME = "saved-prompts.json";
export const SAVED_PROMPTS_LOG_PREFIX = "[dms-assistant sidecar saved prompts]";

/** The bounds of a saved prompt; the dms-assistant module mirrors them. */
export const SAVED_PROMPT_NAME_MAX_LENGTH = 80;
export const SAVED_PROMPT_TEXT_MAX_LENGTH = 20_000;
/** The same cap as the actor frame's `userId`. */
export const SAVED_PROMPT_OWNER_MAX_LENGTH = 200;

/** Why the store refused a write. */
export const SAVED_PROMPT_ERRORS = {
  /** The owner already has a saved prompt of that name. */
  DUPLICATE_NAME: "duplicate_name",
  /** The record would not read back: an empty name, a text over the cap. */
  INVALID: "invalid",
} as const;

export type SavedPromptErrorCode =
  (typeof SAVED_PROMPT_ERRORS)[keyof typeof SAVED_PROMPT_ERRORS];
