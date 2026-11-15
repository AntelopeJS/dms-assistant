import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DatabaseAccess,
  DatabaseEngine,
} from "@antelopejs/interface-dms-builder";
import { z } from "zod";

/** A package manager a project can install its dependencies with. */
export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

/** The driver a check could not load, and the command that installs it into the project. */
export interface DriverInstall {
  package: string;
  command: string;
}

/** A check's answer, with the install step when the engine's driver is missing from the project. */
export type CheckedAccess = DatabaseAccess & { install?: DriverInstall };

const ADD_VERBS: Record<PackageManager, string> = {
  pnpm: "pnpm add",
  yarn: "yarn add",
  bun: "bun add",
  npm: "npm install",
};

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const ManifestSchema = z.object({
  packageManager: z
    .string()
    .transform((spec) => spec.split("@")[0])
    .pipe(z.enum(["pnpm", "yarn", "bun", "npm"])),
});

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

/** The package manager the project names in `packageManager`, else the one whose lockfile it holds, else npm. */
export async function projectPackageManager(
  projectPath: string,
): Promise<PackageManager> {
  const named = await readFile(path.join(projectPath, "package.json"), "utf8")
    .then((text) => ManifestSchema.safeParse(JSON.parse(text)).data)
    .catch(() => undefined);
  if (named !== undefined) return named.packageManager;
  for (const [lockfile, manager] of LOCKFILES) {
    if (await exists(path.join(projectPath, lockfile))) return manager;
  }
  return "npm";
}

/** The command that adds `driver` to the project's `dependencies`, at the range the project can install when one is known. */
export function installCommand(
  manager: PackageManager,
  driver: string,
  version: string | undefined,
): string {
  const spec = version === undefined ? driver : `"${driver}@${version}"`;
  return `${ADD_VERBS[manager]} ${spec}`;
}

/** The driver package whose `probe` checks a database of `engine`. */
export function driverPackageName(engine: DatabaseEngine): string {
  return `@antelopejs/${engine}`;
}

/** Whether `access` is the answer of a check that found no driver of `driver` to probe the database with. */
export function missesDriver(access: DatabaseAccess, driver: string): boolean {
  return (
    !access.reachable &&
    (access.reason?.startsWith(`Install ${driver} to connect `) ?? false)
  );
}
