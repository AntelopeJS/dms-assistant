import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";

const MAX_LINK_HOPS = 40;

const notFoundSchema = z.object({ code: z.enum(["ENOENT", "ENOTDIR"]) });

class UnresolvablePathError extends Error {}

/** The real path of `folder`, through links, the folders that do not exist yet kept by name. */
function realFolder(folder: string): string {
  try {
    return realpathSync(folder);
  } catch (error) {
    if (!notFoundSchema.safeParse(error).success)
      throw new UnresolvablePathError();
    const parent = dirname(folder);
    if (parent === folder) return folder;
    return join(realFolder(parent), basename(folder));
  }
}

/** What the link at `path` names, or undefined when `path` is not a link. */
function linkText(path: string): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
  } catch (error) {
    if (notFoundSchema.safeParse(error).success) return undefined;
    throw new UnresolvablePathError();
  }
}

function followLinks(path: string): string | undefined {
  let current = path;
  for (let hop = 0; hop < MAX_LINK_HOPS; hop += 1) {
    current = join(realFolder(dirname(current)), basename(current));
    const link = linkText(current);
    if (link === undefined) return current;
    current = resolve(dirname(current), link);
  }
  return undefined;
}

/**
 * Where a write to `path` lands, taken from `cwd` when relative: through every
 * link in its folders and at the path itself, a link whose target does not
 * exist yet included. Undefined when no answer is safe to give, as for a loop
 * of links or a folder that cannot be read.
 */
export function writeTarget(path: string, cwd: string): string | undefined {
  try {
    return followLinks(resolve(cwd, path));
  } catch (error) {
    if (error instanceof UnresolvablePathError) return undefined;
    throw error;
  }
}
