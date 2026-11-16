#!/usr/bin/env node
/**
 * Runs the connection-analysis check: two tabs of one browser following one database connection
 * through the real onboarding code, every order of their first steps and answers tried. Prints
 * nothing when it passes. Exits 0 when every rule holds and every recorded defect still breaks,
 * 1 when one changed, 2 when it could not run.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SPEC = "tests/formal/connection-analysis.test.ts";
const EXIT = { changed: 1, tool: 2 };

const run = spawnSync("pnpm", ["--dir", "frontend-vue", "exec", "vitest", "run", SPEC, "--maxWorkers=1", "--reporter=dot"], {
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
