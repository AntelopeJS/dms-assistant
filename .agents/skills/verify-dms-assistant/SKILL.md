---
name: verify-dms-assistant
description: "Drive the AntelopeJS dms-assistant module (the AI assistant: its sidecar, Settings, Changes and Activity pages, the Codex sign-in banner, the onboarding routes and the owner-only routes) the way the platform owner does, inside a DMS with free ports and its own MongoDB database, and report a verdict with evidence. Use to prove a change to AntelopeJS/dms-assistant works before merge, or to verify a PR. A turn with Claude Code or Codex needs credentials a run never holds: that part is NOT VERIFIED, so a verdict is never a plain PASS."
---

# Verify dms-assistant

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `e2e/journeys/<feature>.mjs`, describe it in its feature file, and run it.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of this repository. Run it with Node 24 after `pnpm install`:

```bash
C="pnpm exec dms-control"
$C                       # lists every command
```

Give `doors` and `--skill` absolute paths. The repository holds two verify skills, so `plan`, `map`, `doors` and `verdict` take `--skill` too. `mongod` comes from `DMS_CONTROL_MONGOD` or `PATH`. A verifier that runs with a temporary `HOME` does not see `~/.cache/mongodb-binaries`: pass the binary in `DMS_CONTROL_MONGOD`.

## What this skill cannot verify

A run holds no `ANTHROPIC_API_KEY`, no Claude Code login and no ChatGPT sign-in, so no model turn runs. These are NOT VERIFIED in every verdict, never PASS: a turn with Claude Code or Codex (the chat, tool calls as they happen, approvals, questions, queued messages, auto-fix turns, token counts a turn reports), block previews, and the ChatGPT consent, token exchange and refresh. The chat panel is also out of reach: it exists in the development dashboard only (`import.meta.env.DEV`) and `dms-control up` builds a production one (AntelopeJS/dms#749). The best result of a verdict is therefore PASS+NOTES.

What a turn leaves behind is not out of reach. The Activity rows, the change sets with their diffs and Undo and Redo and the token usage are read from the sidecar's stored conversations, change sets and shadow repository. The journeys write those files (`seed.mjs`, `sample.mjs`), start the assistant on them and drive the pages and routes that read them, so those features are verified.

## Launch

```bash
RUN=$($C up --prepare --base origin/main --skill "$PWD/.agents/skills/verify-dms-assistant")
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the builds of the module and of the sidecar, the install of the playground's own dependencies and the TypeScript build of the playground's fixture module. `up` reads the playground (`e2e/playground/`) and starts an isolated DMS:

- the checkout is laid out again under `$RUN/root`, every sibling linked, and the playground copied, so the run's build and `.antelope/` are its own;
- the API, the dashboard and the mail sink get free ports from the kernel, and `HOME` is `$RUN/home`;
- a `mongod` the run owns serves `verify_<run>` databases;
- the dashboard runs `ajs dms start -e docs -b <api>`. `up` starts the backend with `ajs project start -e docs`, and each journey starts its own, with `ajs project dev -e docs` unless it pins another backend (see Gotchas).

The module under verification is a `local` source at the checkout root, and `@antelopejs/dms` comes from the registry, pinned by the playground's lockfile. The fixture module (`e2e/playground/src`) serves a member with a role (`POST /verify-ai/member`) and registers a home page and a plain page; it declares no skills.

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --skill "$PWD/.agents/skills/verify-dms-assistant" --base origin/main   # the diff mapped to features; unmapped surfaces
$C journey "$RUN" smoke
$C journey "$RUN" settings [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`) and its journeys; the journeys are in `e2e/journeys/<feature>.mjs` (the `journeys` folder of `verify.config.ts`), with the helpers in `e2e/ai.mjs` (requests, checks, members, the sidecar's folder and lock) and `e2e/guard.mjs` (environment loss).
- A journey may set `tag` (Playwright tags such as `"@smoke"`, the set the full CI tier runs) and `knownFailures`, which maps the name of each check that fails today to the finding that makes it fail. A listed check that fails is `known` and does not fail the journey. A listed check that passes is `fixed` and fails the journey until the entry is removed. `last: true` runs a journey after every other one, for a journey that leaves the run's playground changed.
- The same journeys run as the Playwright suite of `e2e/`, which CI runs (`@smoke` on a ready pull request to `main`, every journey nightly): `pnpm e2e` prepares and starts a run, runs every journey on it and stops it; `pnpm e2e -g <feature or journey id>` or `--grep @smoke` narrows it. A journey with `frontend: "dev"` needs the development dashboard: `pnpm e2e:dev` runs only those, on a run started with `up --dev-frontend`, and `pnpm e2e` leaves them out. A journey with `frontend: "dev"` needs the development dashboard: `pnpm e2e:dev` runs only those, on a run started with `up --dev-frontend`, and `pnpm e2e` leaves them out. `DMS_E2E_PREBUILT=1` skips the prepare commands, and `DMS_E2E_RUN=$RUN` drives a run you started with `up`, which it leaves running. Failed journeys keep their evidence under the run, and the report attaches each failed step's screenshot and ARIA snapshot and the backend log.
- A journey starts on an empty database with the administrator onboarded. A journey that needs stored records calls `seedStore(ctx, { conversations, settings, build })`: it stops the backend, empties the sidecar's folder, writes `state.json`, `change-sets.json` and `settings.json`, and starts the backend on them. `build` records real change sets through the sidecar's shadow repository (`recordChangeSet`), so Undo and Redo move bytes on disk. `sample.mjs` is the shared sample: 24 calls in the last seven days of every kind (read-only, Builder, approved, rule, blocked, denied, expired, failed, stopped), 3 reads ten days ago (the last of them a Skill call) and 2 reads forty days ago, and three change sets. The sidecar keeps its settings in the playground's `node_modules/.cache/dms-assistant`, so a journey that depends on them starts with `freshSidecar`, which clears that folder and the run's `~/.claude`. A checkout therefore holds one run at a time.
- `withEnv(ctx, { DMS_ASSISTANT: "0" }, body)` restarts the backend with that environment and restarts it again without.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` for a request, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`. Run every feature instead when the diff touches a shared file, and before a release. The shared files are `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `sidecar/package.json`, `sidecar/pnpm-lock.yaml`, `frontend-vue/package.json` and `frontend-vue/pnpm-lock.yaml` (the sidecar has no workspace file), `.nvmrc`, the `tsconfig.json` of the module and of the sidecar, and this skill's own `verify.config.ts` and the suite's `e2e/ai.mjs`, `e2e/guard.mjs`, `e2e/seed.mjs`, `e2e/sample.mjs`, `e2e/windows.mjs` (every feature loads it through `ai.mjs`) and `e2e/playground/`. A manifest pins the `@antelopejs/interface-*` contracts and the runtime every feature runs on, so `plan` naming only `package` or only `smoke` understates the change: for a lockfile, `.nvmrc` or a tsconfig it names only `smoke`.
2. **Unmapped surface fails the verdict.** User-facing code is `src/**`, `sidecar/src/**`, `frontend-vue/**`, `skills/**` and the two `package.json`, tests and tool configs excluded (`verify.config.ts`). The builder surface (`src/builder/**`, `frontend-vue/builder/**` and the builder message catalogs) belongs to [`verify-dms-builder`](../verify-dms-builder/SKILL.md). `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.** A check that fails today on a known product finding is listed in its journey's `knownFailures` and judged `known`, not failed.
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** None.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. Otherwise PASS+NOTES, with the Not driven list under `notVerified`: the verdict is never a plain PASS here.

Write `$RUN/evidence/judgement.json` (`doors`, `docs`, `notVerified`, `attention`, `verifier`), then `$C verdict "$RUN" --pr <n>`, which writes `$RUN/evidence/verdict.md`. Report the verdict and what you saw in your own reply.

## Gotchas

- Every journey declares `standby: false` (`guarded` in `guard.mjs`), so dms-control boots no standby backend while one runs. A standby loads the module and spawns its own sidecar in the checkout's one sidecar folder, overwriting `sidecar.lock`.- Every dashboard page renders on the server and hydrates after `load`; `guard.mjs` waits for the sign-in form to hydrate, and `choose` and `clickUntil` click again until a radio, a switch or a dialog responds.
- A step whose check fails because the backend or the dashboard stopped answering ends the journey with a `NOT VERIFIED` error and no failing check.
- The sample holds one more record than every documented limit it drives (29 log records for the 25 of a page, 10,005 for the 10,000 of an export, a usage entry on the first day of the 14 and one the day before), so that N and N+1 look different. Add the same when you add a limit.
- The 24 hour, 7 day and 30 day windows are driven with calls 3 hours, 10 days and 40 days old, not at the edge of each window.
- Text the dashboard uppercases (section titles) is matched without regard to case.
- A journey runs a development backend (`ajs project dev`) unless it pins another `backend`: `guarded` in `guard.mjs` sets `backend: "dev"` on every journey, because the module starts its sidecar in development only. `a-development-start-adds-the-dms-server-to-mcp-json-and-keeps-the-rest` also pins it itself, because the module touches `.mcp.json` in development only. `a-production-start-runs-no-sidecar` pins `backend: "production"` to show that `ajs project start` starts no sidecar.
- `an-idle-sidecar-exits-after-its-idle-timeout-and-the-next-probe-starts-it` sets `DMS_ASSISTANT_IDLE_SHUTDOWN_MS` to 20 seconds and restarts the backend with it; it takes about a minute, and nothing else may use the checkout while it runs.

## Not driven

List these under `notVerified` in the judgement of every verdict:

- every model turn (Claude Code, Codex): no credentials in a run. That covers the chat itself, tool calls as they happen, approvals as they are asked and their rules, Full auto, plan mode, questions, queued messages, auto-fix turns, a diff a turn produces, token counts a turn reports, and the tools of the `dms` MCP server of `@antelopejs/dms` the agent calls. (Their stored results are driven from seeded records.)
- the chat panel, shortcuts, palette assistant and block-preview dialog: they need a model turn, which no run holds. A development dashboard (`up --dev-frontend`) drives only the launcher's name;
- block previews and custom sketches (`preview_blocks`, the 64 KB and depth limits, the sketch refusals): the agent's tool, reachable only through a turn;
- the ChatGPT consent page, the token exchange and refresh, `chatgpt-auth.json` with a token, the sign-out of a real session and the pinned `codex` CLI version gate: they need an OpenAI account and the optional peer;
- the first-run popup of the onboarding, except its connect step, and the live check of a Claude token against Anthropic: the AI steps need a login, and the check needs Anthropic. The connect step is driven on a development dashboard; the `/api/builder/database` routes it calls belong to `verify-dms-builder`;
- the Settings banners "The assistant's last turn failed" with Open activity and "N requests are waiting for you": they read a live turn and live approvals;
- the `dms` MCP server, its stdio bridge and the `dms` entry the DMS writes to `.mcp.json`: they belong to `@antelopejs/dms` and its own verification. This module serves no MCP route; it only adds the `dms` entry when it is missing, which `a-development-start-adds-the-dms-server-to-mcp-json-and-keeps-the-rest` drives;
- the Conversation link of the Changes page, the Open conversation button of the Activity detail, and the reload and toast after Undo: they belong to the chat session;
- `NODE_ENV=production`: the DMS itself changes with it, so the run cannot start the backend that way;
- remote access over a LAN, Tailscale, a tunnel or HTTP/2, and the six-connection browser limit (the refusal of a connection to the network address is driven);
- French strings of the pages (the locale files are checked by the repository's own `check-i18n`).
