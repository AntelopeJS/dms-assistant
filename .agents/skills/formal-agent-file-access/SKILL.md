---
name: formal-agent-file-access
description: Bounded exhaustive check that no tool call of the assistant's agent, in any provider, chat mode, generation scope, tool, path or skill source, reads a .env file unasked or writes a configuration file AntelopeJS core reads unasked. Use when a change touches the agent's permission code (`tool-guard`, `safe-mode`, `secret-files`, `session-settings`, `always-ask-files`, `project-secrets`, `permission-preview`, `permission-bus`, the Codex permission handler or profile), adds a tool, a mode or a provider, or changes how a path is resolved.
---

# Formal check: the agent never reaches `.env` or the project configuration unasked

The assistant's agent runs in the owner's project. Two promises hold in every provider and mode: a call whose effect could read a `.env` file is refused, and a write to a file AntelopeJS core reads its configuration from (`antelope.config.ts`, an `antelope.*.json`, anything under `.antelope/`) asks the owner and offers no standing rule. Each fix so far closed one route found while reviewing the previous one (#66, #70, #71, #73, #75): Grep with no path, a `.env*` glob, `cat .env` in Plan, a skill's inline shell command, an `@` reference, hooks, edits to the configuration, Codex patches onto `.env`. This check puts every combination to the real permission code, so the next route is a new line in a list, not a review finding.

The tool is Vitest on the real sidecar code, not a hand model. For Claude it runs the session's own `PreToolUse` hooks (`buildSafeModeHooks` under `withSecretFileGuard`, with the CLI's permission mode as the CLI names it), then, for a call a hook sends to the person, the real permission bus with the owner's standing rules. For Codex it runs the real approval handler over the same bus. Every call gets one verdict: `refused`, `asks`, `filtered` (a Grep rewritten to leave `.env` files out), `cli-refuses` (an edit in Plan, which the CLI itself never runs) or `silent`. The tuples are in `sidecar/tests/formal/agent-file-access-scopes.ts`, the verdicts in `agent-file-access-pipeline.ts`, the case lists in `agent-file-access-cases.ts`, the driver in `agent-file-access.test.ts`.

## Run it

```sh
node .agents/skills/formal-agent-file-access/check.mjs
```

It prints nothing and exits 0 when every rule holds and every recorded defect still fails. Exit 1 means a rule changed, 2 means the tests could not run. `pnpm test` runs it through `tests/formal-agent-file-access.test.cjs`, so `pnpm run checks` covers it, and the sidecar's own Vitest job runs the same file. A run takes about 5 s and needs no Java. A failure lists each broken tuple as `provider mode/scope tool(argument) on path, standing rules: verdict`.

## The property

For every tuple of provider, chat mode, generation scope (safe or vibe), tool, arguments and the owner's standing rules:

1. A call whose effect could read a `.env` file or a variant is `refused`: a file tool on `.env`, `.ENV`, `.env.production`, a padded path, a link or a chain of links to one, a link to a `.env` not yet written, a loop of links, an absolute or `..` path; a Grep or Glob whose file-name glob reaches one (`.env*`, `.env.*`, `**/.env`, `{.env,package.json}`); a Codex patch that adds, updates, deletes or renames onto or from one. Committed templates (`.env.example`) stay readable.
2. Every Grep that is not refused is rewritten to leave `.env` files out: no path, a directory, `*`, `**/*`.
3. A command that could read a `.env` file (`cat .env`, `source .env`, `cp .env x`, `sh -c 'cat .env'`) never runs unasked in any mode: it is refused or asked, Plan included.
4. A write to a configuration file never runs unasked, standing rules or not: an edit tool in Claude, a patch (added, updated, deleted, renamed onto, one of two files) or a command in Claude and Codex, by its name, case, a link, a link to a file not yet written, or a path through a link to `.antelope/`. In Claude's Plan the CLI itself runs no edit.
5. Codex runs every mode under one read-only profile, network closed, with approval on request, and its unreadable globs match every `.env` spelling and none of the templates.
6. A skill cannot pull a `.env` value in without a tool call the hooks see: its inline shell commands and its `hooks` frontmatter are switched off, and every `.env` spelling is denied as an `@` reference.

## What it covers

Bounds: Claude's four modes, Codex's three, both scopes (the Builder is taken as present), 10 file tools, 25 paths, 11 globs, 7 directory searches, 8 commands that read `.env`, 3 that write the configuration, each with and without a standing rule that covers the whole project.

Assumptions the check cannot see, each owned by the CLI or the OS:

- A call no hook settles runs unasked, except an edit in Claude's Plan, which the CLI refuses. A hook callback that does not run, for example because the CLI changed how it names a mode, is not covered.
- A command that asks the owner is the owner's choice: the check treats an approved `cat .env` as the owner's. A sandbox that cannot read `.env` for Claude's shell is not in this branch (#72).
- The check never starts the CLI or Codex: it reads the settings it hands them. A Claude rule glob is matched with `path.matchesGlob`, as the sidecar does itself; an `rg` or Codex git-style glob could read the same text differently.
- A Glob lists names only, so a Glob that lists `.env` is not a read.
- MCP tools that take no path, the Builder tools and the environment passed to the agent's process (`agentEnvironment`) are not covered.

## Findings at the sync commit

None: every rule holds on `next` at the sync commit.

## Before the fixes

The check fails on the code before each fix. `git worktree add` the parent commit, link `node_modules`, copy the four files of `sidecar/tests/formal/agent-file-access*`, run `pnpm exec vitest run tests/formal/agent-file-access.test.ts` in `sidecar`:

| Code | Failing rules (of the 9 tests) |
| --- | --- |
| before #66 (`afae4b9^`) | 8: every file tool on `.env`, Grep and Glob, commands, Codex patches on `.env`, skill sources, and all three configuration rules. Only the Codex profile holds |
| before #70 (`29d8a16^`) | 5: file tools, Grep and Glob, `.env` commands, skill sources, configuration commands |
| before #71 (`6481175^`) | 3: `.env` commands, skill sources, configuration commands |
| before #73 (`1fba281^`) | 1: skill sources (no `settings` at all) |
| before #75 (`86e1f7e^`) | 1: skill sources (`permissions.deny` missing, so an `@` reference to `.env` is not denied) |

The #73 and #75 rows run the skill-source rule on settings that lack the module it imports, so they show that the rule exists, not which of the three sources broke.

## Real bug or modeling error

Read the failing line: it names the provider, mode, scope, tool, argument and path. Replay it by hand: start a conversation in that mode with a project that holds the path, and give the agent the call. It is a modeling error only when the call cannot reach the code that way in production, most likely because a path is not what the agent could write, such as a padded path in a Codex patch (a Codex patch names a file by its exact name, so those targets are `claudeOnly`), or because the CLI never makes that call in that mode. Then fix the tuple and say why here. Never drop a path, a tool or a mode to make the check pass: classify it with a reason, or fix the permission code.

## Changing the check

- A new tool: add it to `FILE_TOOLS` with its path argument. A new built-in tool name appears in `BUILTIN_TOOL_REACH`, so a name the CLI adds that the table does not know is already one of the tuples (`NameAddedByALaterCli`).
- A new route to a `.env` file or a configuration file: add the path to `TARGETS`, the glob to `GLOBS`, the command to `SECRET_READING_COMMANDS` or `CONFIG_WRITING_COMMANDS`, then see it fail before the fix.
- A new mode or provider: add it to `CLAUDE_MODES` or `CODEX_MODES`; the case lists multiply it in.
- A fixed defect: none is recorded. A found one goes in a case marked as an expected failure with its reproduction, and in this file.
- Sync commit: `852e655`. The covered files:

```sh
git diff --stat 852e655 -- sidecar/src/agent sidecar/src/providers/claude sidecar/src/providers/codex/permissions.ts sidecar/src/providers/codex/permission-profiles.ts sidecar/src/providers/codex/config.ts sidecar/src/providers/codex/patch-directories.ts sidecar/src/constants/permissions.ts sidecar/src/constants/project-secrets.ts sidecar/src/constants/tool-kinds.ts
```

Move the sync commit forward only after you confirm the check describes the code at the new commit.

| Case | Code |
| --- | --- |
| Claude hook decisions | `buildSafeModeHooks` (`safe-mode.ts`), `isHostDecided`, `runsInSafeScope`, `POLICY_BY_REACH` (`tool-guard.ts`), `withSecretFileGuard` (`secret-files.ts`) |
| Claude asks the owner | `bridgeCanUseTool` (`provider.ts`), `createPermissionBus`, `describeRequest`, `isAlwaysAsk` (`permission-bus.ts`, `permission-preview.ts`), `isProjectConfigFile`, `isGitHookFile` (`always-ask-files.ts`) |
| `.env` and its links | `reachesSecretFile`, `globReachesSecretFile`, `SECRET_FILE_SEARCH_EXCLUSIONS` (`project-secrets.ts`), `writeTarget` (`write-target.ts`) |
| Codex approvals | `createCodexPermissionHandler` (`permissions.ts`), `declinesEscalations`, `buildTurnOverrides` (`config.ts`), `buildPermissionProfile` (`permission-profiles.ts`), `SECRET_FILE_GLOBS` (`secret-file-globs.ts`) |
| Skill sources | `SDK_SESSION_SETTINGS` (`session-settings.ts`) |
