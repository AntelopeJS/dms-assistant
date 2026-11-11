<a href="https://github.com/AntelopeJS/dms"><img data-illustration src="./.github/readme/strip-ai.svg" width="100%" alt="DMS AI ASSISTANT: part of AntelopeJS DMS, the open-source back office. A glowing button reads Star AntelopeJS DMS."></a>

<div align="center">

# `@antelopejs/dms-assistant`

<a href="https://www.npmjs.com/package/@antelopejs/dms-assistant"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-assistant?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a> <a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-assistant?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a> <a href="https://discord.gg/g4pFt6eXqu"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" data-illustration></a> <a href="https://dms.antelopejs.com/docs/modules/assistant"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" data-illustration></a> <a href="https://github.com/AntelopeJS/dms"><img data-illustration alt="Star AntelopeJS DMS" src="https://img.shields.io/github/stars/AntelopeJS/dms?label=Star%20AntelopeJS%20DMS&style=for-the-badge&labelColor=000000&color=000000&logo=github"></a>

**A development assistant and a visual page editor inside the [AntelopeJS DMS](https://github.com/AntelopeJS/dms) dashboard.**

[Documentation](https://dms.antelopejs.com/docs/modules/assistant) · [All modules](https://github.com/AntelopeJS/dms#modules)

</div>

<img data-illustration alt="Screen recording from the AntelopeJS DMS film. The assistant panel opens next to a dashboard with Claude Code as the coding agent, and the request Add a card with the sites that stopped reporting is typed under the caption Or describe it. The assistant then reports Added the card Delayed sites with Typecheck passed, the changed files dashboard/page.ts and dashboard/stats.ts, and the buttons Review diff and Undo, under the caption A change set. Review it. Undo it." src="./docs/images/assistant.gif">

## What it does

The module brings two tools to the dashboard, both for development.

**The assistant.**

- Docks a chat panel next to any page, with the page as context. `Ctrl` `Shift` `K` opens it.
- Runs a coding agent in a local sidecar. The agent is Claude Code by default, or OpenAI's Codex, and it reads the project, its loaded modules and their skills.
- Edits pages through the builder in Safe mode, or writes code in Code mode. It then typechecks and shows the result live.
- Saves every turn that touches the project as a change set you can review, undo and redo.
- Adds an **Assistant** module for owners, with the **Overview**, **Changes**, **Activity**, **Skills** and **Settings** pages.

With `NODE_ENV=production`, the backend starts no sidecar and the dashboard shows no assistant. The sidecar exits if you start it yourself in production.

**The builder.**

![The builder open on the Helio dashboard, with the block catalog, the canvas and the settings of the Revenue invoiced KPI card](./docs/8.builder/images/captures/editor-selected.webp)

- Turns any DMS page into an editor, opened with the hammer button in the page header or `Ctrl` `B`. In the editor you add blocks from a catalog, arrange them, configure them and bind them to data.
- Writes each edit into the project's TypeScript as an AST rewrite, typechecks it in memory, and writes only if it compiles.
- Creates pages from a layout, arranges the menu, and generates tables with their fields and API.
- Gives a chart or a KPI its numbers from a query, without hand-writing a route, and connects an external database to map its tables.
- Implements [`@antelopejs/interface-dms-builder`](https://www.npmjs.com/package/@antelopejs/interface-dms-builder), so other modules call the same operations, and serves an HTTP API under `/api/builder`.

By default the builder's HTTP API and editor run only in development (`ajs project dev`), and every route requires a tenant owner.

## Install

From the root of a project that already loads `@antelopejs/dms`, add the module with the AntelopeJS CLI:

```bash
ajs project modules add @antelopejs/dms-assistant
```

The module replaces `@antelopejs/dms-ai` and `@antelopejs/dms-builder`. Remove both when you add it, by the names your `antelope.config.ts` gives them: one project loads either this module or those two, never both. Move a `projectRoot` or `api` you set on `dms-builder` under `builder` in this module's config.

```bash
ajs project modules remove dms-ai dms-builder
```

## Configuration

The assistant's keys stay at the top level of the module's `config`. The builder's keys, which `@antelopejs/dms-builder` read at the top level, move under `builder`.

```ts fragment
// antelope.config.ts
"dms-assistant": {
  source: { type: "package", package: "@antelopejs/dms-assistant" },
  config: {
    backendUrl: "${@api.API_LOCAL_BASE_URL}",
    builder: {
      projectRoot: __dirname,
    },
  },
},
```

| Key                       | Default                     | What it does                                                                                  |
| ------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `backendUrl`              | `http://localhost:5010`     | The origin the sidecar reaches the backend on. Point it at the origin the `api` module reserved. |
| `mcpJson`                 | `true`                      | `false` keeps the module from adding its MCP server to the project's `.mcp.json`.              |
| `builder.projectRoot`     | The backend's working directory | The app source root the builder rewrites.                                                 |
| `builder.api.enabled`     | `true` in development only  | Turns the builder's HTTP API and editor on or off, whatever the mode.                          |

Claude Code runs with its own credentials, either its login or `ANTHROPIC_API_KEY` in the backend's environment. Codex runs on your ChatGPT plan and uses no OpenAI API key. To use Codex, install `@openai/codex` at the version that `peerDependencies` pins, then press **Sign in with ChatGPT** in **Assistant** › **Settings**. On a DMS that runs on another machine, finish the sign-in with **Paste the return address**.

Start the backend with `ajs project dev -w`, then the frontend with `ajs dms dev`. Sign in as an owner. Press `Ctrl` `Shift` `K` (`⌘` `⇧` `K` on macOS) for the assistant, and `Ctrl` `B` (`⌘` `B`) or the hammer button in a page header for the builder. To start the backend without the sidecar, set `DMS_AI=0`.

## Requirements

<!-- antelopejs-docs-compat:start -->

| Package                                  | Supported         | Tested with |
| ---------------------------------------- | ----------------- | ----------- |
| `@antelopejs/agent-skills`               | `^0.1.0`          | `0.1.0`     |
| `@antelopejs/interface-api`              | `>=0.3.0 <1.0.0`  | `0.3.0`     |
| `@antelopejs/interface-core`             | `>=0.4.0 <1.0.0`  | `0.4.0`     |
| `@antelopejs/interface-database`         | `>=0.3.0 <1.0.0`  | `0.3.1`     |
| `@antelopejs/interface-database-catalog` | `>=0.0.3 <1.0.0`  | `0.0.3`     |
| `@antelopejs/interface-dms`              | `>=0.12.0 <1.0.0` | `0.13.0`    |
| `@antelopejs/interface-dms-builder`      | `>=0.4.0 <0.5.0`  | `0.4.0`     |

<!-- antelopejs-docs-compat:end -->

The module needs a DMS backend in a release that implements the `@antelopejs/interface-dms` range in the table. The dashboard needs an `@antelopejs/dms-frontend` renderer in the range that `engines["@antelopejs/dms-frontend"]` of `frontend-vue/package.json` declares. The `ajs dms` CLI refuses to build the module with a renderer outside that range. The builder's HTTP routes need an API provider, such as `@antelopejs/api`.

## Documentation

- [Introduction](https://dms.antelopejs.com/docs/modules/assistant/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/assistant/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/assistant/configuration), with the agent providers, Codex, Safe mode, your own Claude Code session and remote access
- [Usage](https://dms.antelopejs.com/docs/modules/assistant/usage/chat)
- [Extending](https://dms.antelopejs.com/docs/modules/assistant/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/assistant/faq)
- [Builder](https://dms.antelopejs.com/docs/modules/assistant/builder/introduction): the page editor, tables, data sources, the interface and the HTTP API

The guide's sources live in [`docs/`](./docs), the builder's in [`docs/8.builder`](./docs/8.builder). The package ships its agent skills in [`skills/`](./skills): `dms-ai`, `dms-ai-code-mode`, `dms-builder`, `dms-builder-safe`, `dms-external-database` and `dms-page-design`. `antelopeJs.skills` declares them, and the assistant loads them into its agent.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a pull request.

One install from the repository root installs the backend, the shipped Vue frontend and the sidecar. Each of the three keeps its own lockfile. The playground is separate and needs its own install for local development. The builds use the installed dependencies and do not install them again.

```bash
pnpm install --frozen-lockfile
pnpm --dir playground install --frozen-lockfile --ignore-workspace
pnpm build
pnpm build:sidecar
pnpm dev                # playground backend
pnpm frontend:dev       # dashboard, in a second terminal
pnpm run checks         # typecheck, lint, format, knip, node tests, size, suppressions, sync
pnpm test:specs         # the builder engine specs (mocha, minutes)
pnpm test:frontend      # the assistant and builder Vue unit suites
pnpm test:components    # the builder component suites
pnpm --dir sidecar test # the sidecar suites
```

<details>
<summary>Repository notes</summary>

- The backend lives in `src/`, the builder's part in `src/builder/`. `construct()` parses the config and constructs the builder, which installs the `@antelopejs/interface-dms-builder` implementation and, when the builder is on, mounts `/api/builder`.
- The module registers one frontend, `frontend-vue`, through `AddFrontendModule` with the Vue renderer. Its setup runs the assistant's, then the builder's from `frontend-vue/builder/dms.frontend.ts`, which registers nothing unless the registration's `dmsBuilder.enabled` option is `true`. The chat panel, `DmsAiChatPanel`, is a docked side panel (`registerSidePanel`); its code is under `frontend-vue/app/chat`. The builder's components keep their `DmsBuilder` names. The renderer bundles the icons it finds in `.vue` files, so an icon name belongs in the component that shows it.
- To build and typecheck the Vue source, run `pnpm --dir frontend-vue verify-source`, or set `DMS_FRONTEND_WORKSPACE` to a generated Inertia workspace that includes this module and run `pnpm --dir frontend-vue build` and `pnpm --dir frontend-vue typecheck`.
- `pnpm test:node` builds once, then runs every suite in `tests/` and `tests/builder/` except the sidecar build smoke test (`pnpm test:sidecar-smoke`). `DMS_PREBUILT=1` skips the build when `dist/` is fresh, as in CI. The opt-in Codex acceptance suite runs with `CODEX_ACCEPTANCE=1 pnpm --dir sidecar test:acceptance`.

</details>

## Part of AntelopeJS DMS

This module installs into [AntelopeJS DMS](https://github.com/AntelopeJS/dms), the open-source back office. Every module adds its pages to the same dashboard, behind the same sign-in and roles.

<!-- antelopejs-dms-modules:start -->

| Module                                                           | What it adds                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`dms-builder`](https://github.com/AntelopeJS/dms-builder)       | Edit pages, tables and data sources by clicking, as TypeScript that compiles             |
| [`dms-ai`](https://github.com/AntelopeJS/dms-ai)                 | An assistant chat in the dashboard, on your own Claude Code or Codex                     |
| [`dms-database`](https://github.com/AntelopeJS/dms-database)     | Schemas, relation diagrams, a data browser and a query console                           |
| [`dms-api`](https://github.com/AntelopeJS/dms-api)               | API health, request logs, per-route statistics and a request tester                      |
| [`dms-automation`](https://github.com/AntelopeJS/dms-automation) | Node-graph automations on schedules, webhooks and DMS events, with a trace for every run |
| [`dms-mailing`](https://github.com/AntelopeJS/dms-mailing)       | E-mail templates in a block editor, versions, a send log and delivery metrics            |
| [`dms-lang`](https://github.com/AntelopeJS/dms-lang)             | Translation coverage, a translation matrix and a translation queue                       |
| [`dms-media`](https://github.com/AntelopeJS/dms-media)           | A media library with folders, per-folder permissions, image sizes and light editing      |
| [`dms-saas`](https://github.com/AntelopeJS/dms-saas)             | Self-service sign-up, plans that gate features, and Stripe billing                       |
| [`dms-marketing`](https://github.com/AntelopeJS/dms-marketing)   | Traffic, conversion funnels with A/B splits and click heatmaps, without cookies          |
| [`dms-frontend`](https://github.com/AntelopeJS/dms-frontend)     | The `ajs dms` CLI, the Vue renderer and the SDK every frontend module builds on          |

<!-- antelopejs-dms-modules:end -->

## License

[Apache-2.0](./LICENSE)
