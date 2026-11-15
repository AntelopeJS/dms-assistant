---
name: verify-dms-builder
description: "Drive the builder surface of AntelopeJS/dms-assistant (the /api/builder/database routes behind the onboarding's Start from an existing database path, the connection check, their access and configuration, and the builder's message catalog) the way a tenant owner's HTTP client does, inside a DMS with free ports and its own MongoDB database, and report a verdict with evidence. Use to prove a change to src/builder or frontend-vue/builder works before merge, or to verify a PR. The page, block, table and data source operations belong to @antelopejs/dms, whose verify-dms skill drives them."
---

# Verify the builder surface of dms-assistant

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `journeys/<feature>.mjs`, describe it in its feature file, and run it.

The pack has no `dms` verify kind, so this skill follows the layout of dms-media and dms-automation. `dms-control` is the bin of `@antelopejs/dms`, a dependency of the skill's own playground (`playground/`). Run it with Node 24 after the repository install and the playground's own install, which `prepare` repeats:

```bash
pnpm --dir .agents/skills/verify-dms-builder/playground install --ignore-workspace --frozen-lockfile --prefer-offline --ignore-scripts
C="node .agents/skills/verify-dms-builder/playground/node_modules/@antelopejs/dms/bin/dms-control.mjs"
$C                       # lists every command
```

Give `doors` and `--skill` absolute paths. The repository holds two verify skills, so `plan`, `map`, `doors` and `verdict` take `--skill` too. Set `TMPDIR` to a folder of yours.

## Launch

```bash
RUN=$($C up --prepare --skill "$PWD/.agents/skills/verify-dms-builder" --base origin/main)
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the build of the module, the playground install and its TypeScript build. The playground builds with its own `tsconfig.build.json` and resolves its packages from its own install. The root's `paths` would point the typings of `@antelopejs/interface-dms`, written for zod 3, at the root's zod 4. `up` starts an isolated DMS from `playground/`:

- the checkout is laid out again under `$RUN/root` and the playground copied without `node_modules`, so the sources the builder rewrites, `.antelope/` and the build are the run's own;
- the API, the dashboard and the mail sink get free ports from the kernel, `HOME` is `$RUN/home`, and the run holds its own `DMS_SETUP_TOKEN` that `onboard` sends with the first registration;
- a `mongod` the run owns serves `verify_<run>` databases;
- the backend runs `ajs project start -e docs` with the builder forced on, because it is off under `start` otherwise. `builder.enabled` on the `dms` entry serves the operations, and `builder.api.enabled` on `dms-assistant` mounts the routes (`VERIFY_BUILDER_API`, see `playground/antelope.config.ts`).

The playground (`playground/src`) is the repository playground's Board page, `orders` table and 18 seeded orders, plus a fixture module under `/verify-builder`: `POST /member` makes a member with a role. The run has no external database and no catalog provider: the journeys call the routes the way the onboarding popup's client does.

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --skill "$PWD/.agents/skills/verify-dms-builder" --base origin/main   # the diff mapped to features; unmapped surfaces
$C journey "$RUN" database [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`) and its journeys; [coverage/](coverage) holds one table per feature with every documented behaviour, its catching check or its `Not driven` reason. Journeys are in `journeys/<feature>.mjs`; helpers are `builder.mjs` (API, project files, `withConfig`, `member`) and `guard.mjs`.
- A journey starts on an empty database with the owner onboarded and the backend restarted on it. A journey that sends a write reads it back through a second view: the project files, the project listing, or the answer of a dry run. The routes write the playground's `antelope.config.ts` and `.env` only for a real connection, so every journey leaves them as they were, and checks that. A journey with `backend: "dev"` runs its backend under `ajs project dev`, which the connection check needs.
- `withConfig(ctx, { VERIFY_BUILDER_*: … }, body)` restarts the backend with `dms-assistant`'s `builder.api.enabled` (`VERIFY_BUILDER_API=off|follow-dev`) or the `dms` entry's `builder.projectRoot` (`VERIFY_BUILDER_PROJECT_ROOT`) set and restarts it again without them.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `fill`, `press`, `screenshot`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` for a request, `file.ts.txt` for a project file read, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`. When the diff touches a shared file (a `package.json`, a `pnpm-lock.yaml`, a `tsconfig*.json` or `verify.config.ts`), and before a release, run every feature instead: `plan` does not widen `run` for these yet.
2. **Unmapped surface fails the verdict.** User-facing code is `src/builder/**`, `frontend-vue/builder/**` and `frontend-vue/i18n/locales/builder-*.json`, tests and tool configs excluded (`verify.config.ts`). `map` checks the whole tree. The rest of the repository belongs to `verify-dms-assistant`.
3. **Every registered journey of a feature in `run` must have run and passed.** Known findings stay as failing journeys (see Gotchas): they fail a verdict only when the diff touches their feature.
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** None.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

Write `$RUN/evidence/judgement.json` (`doors`, `docs`, `notVerified`, `attention`, `verifier`), then `$C verdict "$RUN" --pr <n>`, which writes `$RUN/evidence/verdict.md`. Report the verdict and what you saw in your own reply.

## Gotchas

- In a development dashboard dms-assistant's onboarding popup covers every page until onboarding is done. `guarded` ticks its "Don't show on startup" once per browser before any page script runs; verify-dms-assistant drives the popup itself.
- `POST /database/connections/check` answers the owner 403 outside development, so the connection-check journey that reaches a database pins `backend: "dev"`. A dev backend is not watched: nothing in a run rewrites a source and reloads it.
- The popup's "Start from an existing database" form opens behind a working Claude or Codex sign-in, which a run never holds. The journeys call the routes the way the form's client does, and the client's own logic is pinned by `pnpm --dir frontend-vue test`.
- A dry run of `POST /database/project` with no step answers the configuration file as `kind: "modify"` with an empty `diff`; the journeys use a step that changes something.

## Not driven

List these under `notVerified` in the judgement of every verdict; the per-feature `coverage/` tables carry the rest.

- connecting an external database, analysing it, mapping its relations and the module changes that follow (`POST /database/analyse`, `/map`, `/project` with a real connection, `/connection/remove`, `/connection/url`, `/connections/repair` with a connection): the run has no catalog provider and no external database, so only the empty, refusal and dry-run paths are driven;
- the onboarding popup's form and the client in `frontend-vue/builder` in a browser: no AI sign-in, see Gotchas;
- the check against PostgreSQL and RethinkDB: the run starts a MongoDB only;
- the page, block, table, data source and theme operations of `@antelopejs/interface-dms-builder` and the MCP tools that serve them: `@antelopejs/dms` owns them, and its `verify-dms` skill drives part of them.

## Feature map

[features/README.md](features/README.md).
