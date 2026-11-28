import { HTTPResult } from "@antelopejs/interface-api";
import { z } from "zod";
import { HTTP_STATUS } from "../constants/http";
import { I18N_SECTIONS } from "../constants/i18n";
import {
  DUPLICATE_PROMPT_NAME_CODE,
  INVALID_PROMPT_CODE,
  SAVED_PROMPT_NAME_MAX_LENGTH,
  SAVED_PROMPT_TEXT_MAX_LENGTH,
} from "../constants/prompts";
import type { JsonBody } from "../sidecar";
import { i18nKey } from "../vocabulary";
import type { RefusalToAnswer } from "./sidecar-results";

const HTTP_CONFLICT = 409;

/** The fields of a saved prompt a member writes. */
export type SavedPromptField = "name" | "text";

/** What a member sends to save a prompt: both fields. */
export interface SavedPromptInput {
  name: string;
  text: string;
}

/** What a member sends to edit a prompt: the fields that change, at least one. */
export type SavedPromptPatch = Partial<SavedPromptInput>;

const NameSchema = z.string().trim().min(1).max(SAVED_PROMPT_NAME_MAX_LENGTH);
const TextSchema = z.string().trim().min(1).max(SAVED_PROMPT_TEXT_MAX_LENGTH);

const InputSchema: z.ZodType<
  SavedPromptInput,
  Record<string, JsonBody>
> = z.object({ name: NameSchema, text: TextSchema });

const PatchSchema: z.ZodType<SavedPromptPatch, Record<string, JsonBody>> = z
  .object({ name: NameSchema.optional(), text: TextSchema.optional() })
  .refine((patch) => patch.name !== undefined || patch.text !== undefined);

const MAX_LENGTHS: Record<SavedPromptField, number> = {
  name: SAVED_PROMPT_NAME_MAX_LENGTH,
  text: SAVED_PROMPT_TEXT_MAX_LENGTH,
};

function isField(value: PropertyKey | undefined): value is SavedPromptField {
  return value === "name" || value === "text";
}

/** A 400 naming the field and the reason, as a key both locales translate. */
function invalid(
  field: SavedPromptField | undefined,
  reason: string,
  params: Record<string, string | number> = {},
): HTTPResult {
  return new HTTPResult(HTTP_STATUS.BAD_REQUEST, {
    code: INVALID_PROMPT_CODE,
    field,
    message: i18nKey(I18N_SECTIONS.ERRORS, reason),
    params,
  });
}

/** The refusal of the first problem zod found with a body. */
function refusalOf(error: z.ZodError): HTTPResult {
  const issue = error.issues[0];
  const field = issue?.path[0];
  if (issue === undefined || !isField(field))
    return invalid(undefined, "prompt_body");
  if (issue.code === "too_big") {
    return invalid(field, `prompt_${field}_too_long`, {
      max: MAX_LENGTHS[field],
    });
  }
  return invalid(field, `prompt_${field}_required`);
}

/** What the body is once accepted, else the 400 to answer. */
type ParsedBody<T> = { body: T; refused?: undefined } | { refused: HTTPResult };

function parseWith<T>(
  schema: z.ZodType<T, Record<string, JsonBody>>,
  body: Record<string, JsonBody> | undefined,
): ParsedBody<T> {
  const parsed = schema.safeParse(body ?? {});
  return parsed.success
    ? { body: parsed.data }
    : { refused: refusalOf(parsed.error) };
}

/** A new prompt's body, trimmed, or the 400 that refuses it. */
export function parsePromptInput(
  body: Record<string, JsonBody> | undefined,
): ParsedBody<SavedPromptInput> {
  return parseWith(InputSchema, body);
}

/** An edit's body, trimmed, or the 400 that refuses it, an empty edit included. */
export function parsePromptPatch(
  body: Record<string, JsonBody> | undefined,
): ParsedBody<SavedPromptPatch> {
  return parseWith(PatchSchema, body);
}

/**
 * The sidecar's refusal of a name the member already uses, as the form shows
 * it under the name field; any other refusal is left to `relay`.
 */
export function duplicateNameRefusal(name: string): RefusalToAnswer {
  return (response) =>
    response.status === HTTP_CONFLICT
      ? new HTTPResult(HTTP_CONFLICT, {
          code: DUPLICATE_PROMPT_NAME_CODE,
          field: "name",
          message: i18nKey(I18N_SECTIONS.ERRORS, "prompt_name_taken"),
          params: { name },
        })
      : undefined;
}
