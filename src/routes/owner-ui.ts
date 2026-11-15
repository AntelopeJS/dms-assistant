import { HTTPResult } from "@antelopejs/interface-api";

/**
 * The header only the assistant's own dashboard client sends on a request that hands the module a
 * connection target or a secret. An HTML form, a dashboard block and a fetched page send the owner's
 * session but cannot set a request header, so a route that requires it answers its own UI alone.
 */
export const OWNER_UI_HEADER = "x-dms-ui-assistant";

/** The value the assistant's client sends in `OWNER_UI_HEADER`. */
export const OWNER_UI_VALUE = "1";

const HTTP_FORBIDDEN = 403;

/** The refusal of a request that does not come from the assistant's own UI, or nothing when it does. */
export function outsideOwnerUi(
  marker: string | undefined,
): HTTPResult | undefined {
  if (marker === OWNER_UI_VALUE) return undefined;
  return new HTTPResult(HTTP_FORBIDDEN, {
    code: "forbidden",
    message: `This route answers the assistant's own UI only: send the ${OWNER_UI_HEADER} header.`,
  });
}
