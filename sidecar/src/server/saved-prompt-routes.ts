import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { HTTP_STATUS } from "../constants/http.js";
import {
  SAVED_PROMPT_ERRORS,
  SAVED_PROMPT_NAME_MAX_LENGTH,
  SAVED_PROMPT_OWNER_MAX_LENGTH,
  SAVED_PROMPT_TEXT_MAX_LENGTH,
  type SavedPromptErrorCode,
} from "../constants/saved-prompts.js";
import {
  SavedPromptError,
  type SavedPromptStore,
} from "../state/saved-prompts.js";
import { readBody, sendJson } from "./http-io.js";
import { optionalParam } from "./http-params.js";

/** The query parameter and body field that name the member a request acts for. */
const OWNER_FIELD = "owner";

const UNKNOWN_PROMPT_MESSAGE = "Unknown saved prompt.";
const MISSING_OWNER_MESSAGE = "Missing owner.";
const INVALID_BODY_MESSAGE = "Invalid saved prompt.";

const OwnerSchema = z.string().trim().min(1).max(SAVED_PROMPT_OWNER_MAX_LENGTH);
const NameSchema = z.string().trim().min(1).max(SAVED_PROMPT_NAME_MAX_LENGTH);
const TextSchema = z.string().trim().min(1).max(SAVED_PROMPT_TEXT_MAX_LENGTH);

/** `POST /prompts`: who saves, and the prompt. */
const CreateBodySchema = z.object({
  [OWNER_FIELD]: OwnerSchema,
  name: NameSchema,
  text: TextSchema,
});

/** `PUT /prompts/:id`: who edits, and what changes. */
const PatchBodySchema = z.object({
  [OWNER_FIELD]: OwnerSchema,
  name: NameSchema.optional(),
  text: TextSchema.optional(),
});

const STATUS_BY_ERROR: Record<SavedPromptErrorCode, number> = {
  [SAVED_PROMPT_ERRORS.DUPLICATE_NAME]: HTTP_STATUS.CONFLICT,
  [SAVED_PROMPT_ERRORS.INVALID]: HTTP_STATUS.BAD_REQUEST,
};

/** What the saved-prompt routes read: the store, and the request they answer. */
export interface SavedPromptRouteDeps {
  savedPromptStore: SavedPromptStore;
}

interface RouteMatch {
  params: string[];
  query: URLSearchParams;
}

type SavedPromptRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  deps: SavedPromptRouteDeps,
  match: RouteMatch,
) => Promise<void> | void;

async function parseBody<T extends z.ZodType>(
  req: IncomingMessage,
  schema: T,
): Promise<z.infer<T> | null> {
  const raw = await readBody(req);
  try {
    const parsed = schema.safeParse(JSON.parse(raw === "" ? "{}" : raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The store's refusal as the module reads it: its status, code and message. Anything else is rethrown. */
function sendRefusal(res: ServerResponse, err: SavedPromptError): void {
  sendJson(res, STATUS_BY_ERROR[err.code], {
    code: err.code,
    message: err.message,
  });
}

function isRefusal(err: unknown): err is SavedPromptError {
  return err instanceof SavedPromptError;
}

const listPrompts: SavedPromptRouteHandler = (_req, res, deps, match) => {
  const owner = optionalParam(match.query, OWNER_FIELD);
  if (owner === undefined) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, { message: MISSING_OWNER_MESSAGE });
    return;
  }
  const results = deps.savedPromptStore.listFor(owner);
  sendJson(res, HTTP_STATUS.OK, { results, total: results.length });
};

const createPrompt: SavedPromptRouteHandler = async (req, res, deps) => {
  const body = await parseBody(req, CreateBodySchema);
  if (body === null) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, { message: INVALID_BODY_MESSAGE });
    return;
  }
  try {
    const { [OWNER_FIELD]: ownerId, name, text } = body;
    sendJson(
      res,
      HTTP_STATUS.OK,
      deps.savedPromptStore.create({ ownerId, name, text }),
    );
  } catch (err) {
    if (!isRefusal(err)) throw err;
    sendRefusal(res, err);
  }
};

const updatePrompt: SavedPromptRouteHandler = async (req, res, deps, match) => {
  const body = await parseBody(req, PatchBodySchema);
  if (body === null) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, { message: INVALID_BODY_MESSAGE });
    return;
  }
  try {
    const { [OWNER_FIELD]: ownerId, ...patch } = body;
    const updated = deps.savedPromptStore.update(
      match.params[0] ?? "",
      ownerId,
      patch,
    );
    if (updated === null) {
      sendJson(res, HTTP_STATUS.NOT_FOUND, { message: UNKNOWN_PROMPT_MESSAGE });
      return;
    }
    sendJson(res, HTTP_STATUS.OK, updated);
  } catch (err) {
    if (!isRefusal(err)) throw err;
    sendRefusal(res, err);
  }
};

const deletePrompt: SavedPromptRouteHandler = (_req, res, deps, match) => {
  const owner = optionalParam(match.query, OWNER_FIELD);
  if (owner === undefined) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, { message: MISSING_OWNER_MESSAGE });
    return;
  }
  const id = match.params[0] ?? "";
  if (!deps.savedPromptStore.remove(id, owner)) {
    sendJson(res, HTTP_STATUS.NOT_FOUND, { message: UNKNOWN_PROMPT_MESSAGE });
    return;
  }
  sendJson(res, HTTP_STATUS.OK, { deleted: id });
};

/**
 * The saved prompts of one member. Every request names the member it acts for
 * (`owner`, the DMS `userId`), stamped by the dms-assistant module from the
 * signed-in session and never read from a browser; a prompt of another member
 * answers 404, as if it did not exist.
 */
export const SAVED_PROMPT_ROUTES: readonly {
  method: string;
  pattern: RegExp;
  handle: SavedPromptRouteHandler;
}[] = [
  { method: "GET", pattern: /^\/prompts$/, handle: listPrompts },
  { method: "POST", pattern: /^\/prompts$/, handle: createPrompt },
  { method: "PUT", pattern: /^\/prompts\/([^/]+)$/, handle: updatePrompt },
  { method: "DELETE", pattern: /^\/prompts\/([^/]+)$/, handle: deletePrompt },
];
