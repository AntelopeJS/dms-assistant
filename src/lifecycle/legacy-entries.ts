import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  GetModuleInfo,
  ListModules,
  type ModuleDeclaration,
} from "@antelopejs/interface-core/modules";
import { z } from "zod";
import type {
  DmsKey,
  DmsValue,
  LegacyEntry,
  LegacySetting,
} from "./builder-settings-plan";

const TextSchema = z.string().min(1).optional().catch(undefined);
const EnabledSchema = z.boolean().optional().catch(undefined);

type Found = [key: DmsKey, legacyPath: string, value: DmsValue | undefined];

function held(found: readonly Found[]): LegacySetting[] {
  return found.flatMap(([key, legacyPath, value]) =>
    value === undefined ? [] : [{ key, legacyPath, value }],
  );
}

export function relativeTo(base: string, folder: string): string {
  const relative = path.relative(base, path.resolve(base, folder));
  return relative === "" ? "." : relative.split(path.sep).join(path.posix.sep);
}

interface LegacySource {
  package: string;
  removable: boolean;
  settings: z.ZodType<LegacySetting[]>;
}

function legacySourcesByPrecedence(cwd: string): LegacySource[] {
  const folderToMove = (folder: string | undefined) => {
    if (folder === undefined) return undefined;
    const fromCwd = relativeTo(cwd, folder);
    return fromCwd === "." ? undefined : fromCwd;
  };
  return [
    {
      package: "@antelopejs/dms-assistant",
      removable: false,
      settings: z
        .object({
          builder: z
            .object({ projectRoot: TextSchema })
            .optional()
            .catch(undefined),
        })
        .catch({})
        .transform(({ builder }) =>
          held([
            [
              "projectRoot",
              "builder.projectRoot",
              folderToMove(builder?.projectRoot),
            ],
          ]),
        ),
    },
    {
      package: "@antelopejs/dms-builder",
      removable: true,
      settings: z
        .object({
          projectRoot: TextSchema,
          api: z.object({ enabled: EnabledSchema }).optional().catch(undefined),
        })
        .catch({})
        .transform(({ projectRoot, api }) =>
          held([
            ["projectRoot", "projectRoot", folderToMove(projectRoot)],
            ["enabled", "api.enabled", api?.enabled],
          ]),
        ),
    },
    {
      package: "@antelopejs/dms-ai",
      removable: true,
      settings: z
        .object({ backendUrl: TextSchema })
        .catch({})
        .transform(({ backendUrl }) =>
          held([["backendUrl", "backendUrl", backendUrl]]),
        ),
    },
  ];
}

const PackageNameSchema = z.object({ name: z.string() });

export type Declarations = ReadonlyMap<string, ModuleDeclaration>;

async function packageName(folder: string): Promise<string | undefined> {
  try {
    const text = await readFile(path.join(folder, "package.json"), "utf8");
    return PackageNameSchema.parse(JSON.parse(text)).name;
  } catch {
    return undefined;
  }
}

/** The legacy packages a git repository or an entry's key names, by that name. */
const LEGACY_BY_NAME: ReadonlyMap<string, string> = new Map([
  ["dms-builder", "@antelopejs/dms-builder"],
  ["dms-ai", "@antelopejs/dms-ai"],
]);

function repositoryOf(remote: string): string | undefined {
  return /([^/:]+?)(?:\.git)?\/*$/.exec(remote)?.[1];
}

async function declaredPackage(
  projectPath: string,
  source: ModuleDeclaration["source"],
): Promise<string | undefined> {
  switch (source?.type) {
    case "package":
      return source.package;
    case "local":
    case "local-folder":
      return packageName(path.resolve(projectPath, source.path));
    case "git":
      return LEGACY_BY_NAME.get(repositoryOf(source.remote) ?? "");
    default:
      return undefined;
  }
}

async function loadedPackages(): Promise<Map<string, string>> {
  const named = await Promise.all(
    (await ListModules()).map(async (id): Promise<[string, string][]> => {
      const name = await GetModuleInfo(id).then(
        (info) => packageName(info.localPath),
        () => undefined,
      );
      return name === undefined ? [] : [[id, name]];
    }),
  );
  return new Map(named.flat());
}

/**
 * Each entry's package: for a loaded entry, the name in the package.json core loaded it from,
 * whatever its source; otherwise the one its source names, a `package`, the package.json of a
 * `local` or `local-folder` path, or a `git` remote whose repository is dms-builder or dms-ai; and
 * last, when the source cannot tell, the legacy package its key names.
 */
export async function legacyEntries(
  { cwd, projectPath }: { cwd: string; projectPath: string },
  declarations: Declarations,
): Promise<LegacyEntry[]> {
  const loaded = await loadedPackages();
  const declared = await Promise.all(
    [...declarations].map(async ([id, { source, config }]) => ({
      id,
      config,
      packageName:
        loaded.get(id) ??
        (await declaredPackage(projectPath, source)) ??
        LEGACY_BY_NAME.get(id),
    })),
  );
  return legacySourcesByPrecedence(cwd).flatMap((legacy) =>
    declared
      .filter((entry) => entry.packageName === legacy.package)
      .map(({ id, config }) => ({
        id,
        removable: legacy.removable,
        settings: legacy.settings.parse(config),
      })),
  );
}
