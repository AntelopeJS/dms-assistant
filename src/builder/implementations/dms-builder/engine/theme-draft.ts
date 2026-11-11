import type { ValidationIssue } from "@antelopejs/interface-dms-builder";
import { z } from "zod";

const TEXT = z.string({
  error: (issue) => `${String(issue.path?.at(-1))} is not a string`,
});

const TEXT_BY_NAME = z.record(z.string(), TEXT, { error: "is not an object" });

const VARIABLE_SETS = z.object(
  {
    shared: TEXT_BY_NAME.optional(),
    light: TEXT_BY_NAME.optional(),
    dark: TEXT_BY_NAME.optional(),
  },
  { error: "is not an object of shared, light and dark variables" },
);

const UPLOAD = z.object(
  {
    slot: TEXT,
    mode: TEXT,
    contentType: TEXT,
    base64Content: TEXT,
  },
  { error: "is not an upload" },
);

/**
 * What a `ThemeDraft` holds that a wrong type would otherwise carry deep into
 * the write, where it would fail as a server error. `colors`, `logos` and
 * `uploads` may be absent. Which names and values are valid is checked after
 * this.
 */
const THEME_DRAFT = z.object(
  {
    variables: VARIABLE_SETS,
    colors: TEXT_BY_NAME.optional(),
    logos: z
      .record(z.string(), TEXT_BY_NAME, {
        error: "is not an object of logo slots",
      })
      .optional(),
    uploads: z.array(UPLOAD, { error: "is not a list of uploads" }).optional(),
  },
  { error: "the theme is not an object of variables, colors and logos" },
);

type DraftContent = z.infer<typeof THEME_DRAFT>;

/** Parses a draft that may be arbitrary JSON: one sent over HTTP is. */
export function parseThemeDraft(
  draft: unknown,
): z.ZodSafeParseResult<DraftContent> {
  return THEME_DRAFT.safeParse(draft);
}

/** One issue per value of the draft that failed to parse, at its JSON pointer. */
export function malformedDraftIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    pointer: issue.path.map((segment) => `/${String(segment)}`).join(""),
    message: issue.message,
  }));
}
