# dms-assistant

An AntelopeJS DMS development assistant, published as `@antelopejs/dms-assistant`. It merges two former modules: the assistant (`@antelopejs/dms-ai`: an owner-only AI workspace in the dashboard, backed by a local sidecar supporting Claude Code and optional Codex) and the builder (`@antelopejs/dms-builder`: the engine that changes pages, tables and data sources as AST rewrites of the project sources, and the external database connect flow). `@antelopejs/dms` hosts the builder engine, implements `@antelopejs/interface-dms-builder` and serves the builder tools through its `dms` MCP server. This module keeps the external database connect routes, which run on the external-database operations of `@antelopejs/dms`.

## Layout

| Path           | What it is                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `src`          | The DMS module (CommonJS, built to `dist`); `construct`, `start` and `destroy` in `src/index.ts` run both parts |
| `src/builder`  | The external database connect routes under `/api/builder/database`, which call the operations of `@antelopejs/interface-dms-builder` |
| `sidecar`      | The local agent process, an ESM workspace package with its own lockfile and tsconfig; ships as `sidecar/dist`. Its `dms-assistant` MCP server holds only the chat's tools. Every session also gets the `dms` MCP server of `@antelopejs/dms` |
| `frontend-vue` | The dashboard layer, one frontend registration. ESLint and Prettier own it, not oxlint and oxfmt; Prettier skips `frontend-vue/builder` |
| `frontend-vue/builder` | The client and types of the builder's `/api/builder/database` routes and the builder's message catalog, with its own vitest config. The builder has no editor UI: pages change through the AI and the mockup flow |
| `playground`   | A DMS project that loads the module; its own lockfile, outside the pnpm workspace                       |
| `skills`       | The module's own agent skills, shipped through `antelopeJs.skills`. The chat loads the DMS workflow skills of `@antelopejs/agent-skills` before them |

The root `package.json` is the published CommonJS package, so it has no `"type": "module"`. Node therefore warns that it reparses `oxlint.config.ts` as ESM; the warning is harmless.

## Versioning

- The Codex CLI must match the exact `@openai/codex` pin in `package.json`: the sidecar ships that version's app-server protocol types, generated into `sidecar/src/providers/codex/protocol` by `pnpm --dir sidecar generate:codex-types`.
- `frontend-vue/package.json` pins the supported `@antelopejs/dms-frontend` minor in `engines`.
- See `sidecar/src/constants/providers.ts` for provider availability. An unavailable provider reports an error rather than falling back to another provider.

## Tests

`pnpm test`, and so `pnpm run checks`, runs `pnpm test:node`: it builds `dist` once and runs every `tests/*.test.cjs` suite except `sidecar-build.test.cjs` and `installed-module.test.cjs`, and every `tests/builder/*.test.cjs` suite, against it. Run the tests on the Node version in `.nvmrc`: under Node 26, 51 frontend-vue tests fail.

`checks` does not run:

- The Vitest suites, which run in their own CI job: `pnpm --dir sidecar test` and `pnpm --dir frontend-vue test` (the assistant and builder unit suites).
- `pnpm test:sidecar-smoke`, which builds the sidecar and checks its output.
- `pnpm test:installed`, which packs the module, installs the tarball as the AntelopeJS module cache does, starts the installed sidecar and checks that every package its built files import resolves. CI runs it in the `installed-module` job, which `ubuntu` needs, and the release runs it before it starts.
- The Codex acceptance suite: `CODEX_ACCEPTANCE=1 pnpm --dir sidecar test:acceptance`.
- The full frontend-vue typecheck: `pnpm --dir frontend-vue verify-source` builds the DMS core layer with this one and runs vue-tsc. `checks` typechecks only the chat (`typecheck:chat`).

## CI

Branch protection requires the `ci / checks` and `ubuntu` checks. In `.github/workflows/ci.yml`, `ci` calls the shared `ci-node.yml`, whose `checks` job reports `ci / checks`, and `ubuntu` fails when `ci`, the `vitest` matrix or `frontend-verify` fails, so keep both names.

## Releases

The release commit writes `CHANGELOG.md`. Upgrade notes for that version follow in a separate `docs(changelog)` pull request.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-dms-assistant/SKILL.md`](.agents/skills/verify-dms-assistant/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
