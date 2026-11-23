#!/usr/bin/env node
/**
 * Runs the stored-state-load check: state.json and change-sets.json made of
 * valid and malformed entries in any mix, loaded and written by the real
 * stores. Prints nothing when it passes. Exits 1 when a property fails, 2 when
 * it could not run.
 *
 * @packageDocumentation
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SPEC = "tests/formal/stored-state-load.test.ts";
const EXIT = { changed: 1, tool: 2 };

const run = spawnSync(`pnpm --dir sidecar exec vitest run ${SPEC} --maxWorkers=1 --reporter=dot`, {
  shell: true,
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 268_435_456,
});
if (run.error) {
  console.error(`check: cannot run pnpm: ${run.error.message}`);
  process.exit(EXIT.tool);
}
if (run.status !== 0) {
  process.stderr.write(`${run.stdout}${run.stderr}`);
  process.exit(/FAIL|AssertionError|expected/.test(run.stdout + run.stderr) ? EXIT.changed : EXIT.tool);
}
