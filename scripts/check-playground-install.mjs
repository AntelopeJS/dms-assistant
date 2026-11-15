import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR_BUILD = "pnpm build:sidecar";
const PLAYGROUNDS = [
  "playground",
  ".agents/skills/verify-dms-assistant/playground",
];

const requirements = [
  {
    file: "playground/antelope.config.ts",
    pattern:
      /installCommand: \["pnpm install", "pnpm build", "pnpm build:sidecar"\]/,
  },
  { file: ".agents/playground", pattern: new RegExp(SIDECAR_BUILD) },
];

const buildFailures = requirements
  .filter(
    ({ file, pattern }) =>
      !pattern.test(readFileSync(join(root, file), "utf8")),
  )
  .map(
    ({ file }) =>
      `${file}: the playground must build the sidecar before startup (\`${SIDECAR_BUILD}\`).`,
  );

const DATABASE_DRIVERS = [
  "@antelopejs/mongodb",
  "@antelopejs/mysql",
  "@antelopejs/postgres",
  "@antelopejs/rethinkdb",
];

const ManifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
});

const playgroundDependencies = ManifestSchema.parse(
  JSON.parse(readFileSync(join(root, "playground/package.json"), "utf8")),
).dependencies;

const clientFailures = DATABASE_DRIVERS.filter(
  (driver) => !Object.hasOwn(playgroundDependencies, driver),
).map(
  (driver) =>
    `playground/package.json: @antelopejs/dms runs the probe of ${driver} from the project to check a database; declare it in dependencies.`,
);

const OUTDATED_LOCKFILE = "ERR_PNPM_OUTDATED_LOCKFILE";

/**
 * Runs a frozen lockfile-only install of one playground.
 *
 * @param {string} dir The playground, relative to the repository root
 * @returns {string | null} The failure to report, or null when the lockfile matches
 */
function lockfileFailure(dir) {
  const result = spawnSync(
    "pnpm",
    [
      "install",
      "--dir",
      dir,
      "--ignore-workspace",
      "--frozen-lockfile",
      "--lockfile-only",
      "--ignore-scripts",
    ],
    { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status === 0) return null;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (output.includes(OUTDATED_LOCKFILE)) {
    return `${dir}/pnpm-lock.yaml does not match ${dir}/package.json: run \`pnpm install --dir ${dir} --ignore-workspace --lockfile-only\`.`;
  }
  const reason = result.error?.message ?? output.trim();
  return `${dir}: pnpm could not check the lockfile: ${reason}`;
}

const lockfileFailures = PLAYGROUNDS.map(lockfileFailure).filter(
  (failure) => failure !== null,
);

const failures = [...buildFailures, ...clientFailures, ...lockfileFailures];

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
