import { HTTPResult } from "@antelopejs/interface-api";
import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";
import { z } from "zod";
import {
  type DatabaseAccess,
  DATABASE_ENGINES,
  type DatabaseEngine,
  ENGINE_SCHEMES,
} from "../implementations/dms-builder/engine/database-access";
import { checkDatabase } from "../implementations/dms-builder/engine/database-check";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const SCHEME = /^([a-z][a-z0-9+.-]*:)\/\//i;

function isUrlOf(engine: DatabaseEngine, url: string): boolean {
  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
  return scheme !== undefined && ENGINE_SCHEMES[engine].includes(scheme);
}

const CheckBodySchema = z
  .object({ engine: z.enum(DATABASE_ENGINES), url: z.string() })
  .refine(({ engine, url }) => isUrlOf(engine, url), { path: ["url"] });

/** The body of `POST /database/connections/check`: the engine to check and the URL that connects to it. */
export type ConnectionCheckBody = z.infer<typeof CheckBodySchema>;

/**
 * The route's work. The builder is development tooling that a project may mount anywhere through
 * `api.enabled`, and this route opens a connection to a host the caller names, so it answers
 * `403` unless the core runs in development. A body that is not `{ engine, url }` for an engine
 * and its URL scheme answers `400`, naming the fields and never their values.
 */
export async function runConnectionCheck(
  body: ConnectionCheckBody,
): Promise<DatabaseAccess | HTTPResult> {
  if (!(await GetRuntimeInfo()).dev) {
    return new HTTPResult(HTTP_FORBIDDEN, {
      code: "forbidden",
      message: "Databases are checked in development only.",
    });
  }
  const parsed = CheckBodySchema.safeParse(body);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map(({ path }) => String(path[0]))),
    ];
    return new HTTPResult(HTTP_BAD_REQUEST, {
      code: "bad_request",
      message: `Expected an engine of ${DATABASE_ENGINES.join(", ")} and a URL of that engine; check ${fields.join(", ")}.`,
    });
  }
  return checkDatabase(parsed.data.engine, parsed.data.url);
}
