import {
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ROUTE_PREFIX } from "../constants/module";
import { buildQuery, type JsonBody, pathSegment } from "../sidecar";
import type { DeletedPrompt, SavedPrompt, SidecarList } from "../types";
import {
  duplicateNameRefusal,
  parsePromptInput,
  parsePromptPatch,
} from "./prompt-body";
import { relay } from "./sidecar-results";
import {
  DELETED_PROMPT_ANSWER,
  SAVED_PROMPT_ANSWER,
  SAVED_PROMPT_PAGE_ANSWER,
} from "./sidecar-answers";

const PROMPTS_PATH = "/prompts";

/** The sidecar's name for the member a request acts for. */
const OWNER_FIELD = "owner";

function same<T>(body: T): T {
  return body;
}

function promptPath(id: string): string {
  return `${PROMPTS_PATH}/${pathSegment(id)}`;
}

/**
 * The saved prompts of the signed-in member: list, save, edit and delete.
 * Every request to the sidecar names the member from the session (`owner`),
 * never from the browser, so a member reaches their own prompts alone. The
 * module validates the body first and answers a translated 400; a name the
 * member already uses comes back as a translated 409 under the name field.
 */
@AuthOwnerOnly()
export class AISavedPromptsController extends Controller(ROUTE_PREFIX) {
  @Get(PROMPTS_PATH)
  list(
    @AuthRawUser() user: User,
  ): Promise<SidecarList<SavedPrompt> | HTTPResult> {
    const query = buildQuery({ [OWNER_FIELD]: user._id });
    return relay(`${PROMPTS_PATH}${query}`, SAVED_PROMPT_PAGE_ANSWER, same);
  }

  @Post(PROMPTS_PATH)
  create(
    @AuthRawUser() user: User,
    @JSONBody() body: Record<string, JsonBody> | undefined,
  ): Promise<SavedPrompt | HTTPResult> {
    const parsed = parsePromptInput(body);
    if (parsed.refused) return Promise.resolve(parsed.refused);
    return relay(
      PROMPTS_PATH,
      SAVED_PROMPT_ANSWER,
      same,
      { method: "POST", body: { [OWNER_FIELD]: user._id, ...parsed.body } },
      duplicateNameRefusal(parsed.body.name),
    );
  }

  @Put(`${PROMPTS_PATH}/:id`)
  update(
    @Parameter("id", "param") id: string,
    @AuthRawUser() user: User,
    @JSONBody() body: Record<string, JsonBody> | undefined,
  ): Promise<SavedPrompt | HTTPResult> {
    const parsed = parsePromptPatch(body);
    if (parsed.refused) return Promise.resolve(parsed.refused);
    return relay(
      promptPath(id),
      SAVED_PROMPT_ANSWER,
      same,
      { method: "PUT", body: { [OWNER_FIELD]: user._id, ...parsed.body } },
      parsed.body.name === undefined
        ? undefined
        : duplicateNameRefusal(parsed.body.name),
    );
  }

  @Delete(`${PROMPTS_PATH}/:id`)
  remove(
    @Parameter("id", "param") id: string,
    @AuthRawUser() user: User,
  ): Promise<DeletedPrompt | HTTPResult> {
    const query = buildQuery({ [OWNER_FIELD]: user._id });
    return relay(`${promptPath(id)}${query}`, DELETED_PROMPT_ANSWER, same, {
      method: "DELETE",
    });
  }
}
