#!/usr/bin/env node
/**
 * Runs the agent-file-access check: every Claude and Codex tool call, mode and path the sidecar sees
 * against the real permission code. Prints
 * nothing when it passes. Exits 0 when every rule holds and every recorded defect still breaks,
 * 1 when one changed, 2 when it could not run.
 *
 * @packageDocumentation
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SPEC = "tests/formal/agent-file-access.test.ts";
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
