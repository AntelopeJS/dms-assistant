#!/usr/bin/env node
/**
 * Checks that deleted conversations stay closed. First model-checks
 * ConversationDeletion.tla under three configs with the shared runner of
 * `@antelopejs/tooling-configs/formal`: `Current` (the code today) must hold
 * every rule, and `Before60` and `Before59` (the code before those fixes)
 * must still break the recorded rules with the recorded shortest
 * counterexamples. Then replays those counterexamples against the real
 * conversation store. Exits 1 when a rule changed, 2 when TLC or Vitest
 * could not run.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../..");
const spec = "ConversationDeletion";
const REPLAYS = "tests/formal/conversation-deletion.test.ts";
const EXIT = { changed: 1, tool: 2 };

await checkSpec({ dir, spec, config: "Current", findings: {} });
await checkSpec({
  dir,
  spec,
  config: "Before60",
  findings: { DeletedStaysDeleted: 5, NoTurnStartsAfterDelete: 4 },
});
await checkSpec({
  dir,
  spec,
  config: "Before59",
  findings: { DeletedStaysDeleted: 5, NoTurnStartsAfterDelete: 4 },
});

const replay = spawnSync("pnpm", ["--dir", "sidecar", "exec", "vitest", "run", REPLAYS, "--reporter=dot"], {
  cwd: root,
  encoding: "utf8",
});
if (replay.error) {
  console.error(`check: cannot run pnpm: ${replay.error.message}`);
  process.exit(EXIT.tool);
}
if (replay.status !== 0) {
  process.stderr.write(`${replay.stdout}${replay.stderr}`);
  process.exit(EXIT.changed);
}
