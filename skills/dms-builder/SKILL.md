---
name: dms-builder
description: Uses the builder of @antelopejs/dms-assistant, the AntelopeJS DMS module which edits a project's pages, tables and data sources as typechecked AST rewrites of its TypeScript sources (the /api/builder HTTP API and @antelopejs/interface-dms-builder; it has no editor UI). Use when configuring the builder (`builder.projectRoot`, `builder.api.enabled`), calling its interface or HTTP API from code, or when its routes are missing. For page edits through the dms-ai agent tools, use dms-builder-safe.
icon: i-lucide-hammer
category: builder
tags: [builder, pages, ast, typecheck, interface]
---

# dms-builder

The builder has no store of its own: pages are `PageController` classes, blocks their static fields or `.child()` calls, tables a `Table` + `DataController` + model. Every write is staged in memory, typechecked across the project, and written only if it compiles. User docs: https://dms.antelopejs.com/docs/modules/assistant/builder/introduction (source: `docs/8.builder/` of this package); interface reference: `node_modules/@antelopejs/interface-dms-builder/docs`.

## Surfaces

- **Clients**: the dms-ai agent tools (`builder_*`, see dms-builder-safe) call the interface through the assistant's backend; **Build it** in the DMS mockup Edit mode calls the HTTP API. There is no editor UI on a live page. Connecting an existing database starts from the onboarding popup's **Start from an existing database** or from the agent (dms-external-database).
- **Interface** (`@antelopejs/interface-dms-builder`): `ListPages`, `GetPageStructure`, `AddBlock`, `SetPageBlocks`, `PreviewLayout`, `CreateResource`, `AddQuery`… Mutations return `OpResult` (`{ ok, data, changes }` / `{ ok: false, error }`): branch on `ok`.
- **HTTP**: `/api/builder/*`, tenant owner only, same `OpResult`. Pass the structure's `version` as `expectedVersion` to fail with `stale` instead of overwriting.

## Config

`projectRoot` (absolute source root, default the working directory), `api.enabled` (default: the core's dev flag). It needs `@antelopejs/dms` 0.13.1 or newer and `@antelopejs/dms-frontend` 0.9.2 or newer within the ranges in the package manifests.

## Gotchas

- Off under `ajs project start`: no routes (404). `api.enabled: true` forces it on.
- Blocks are read back by shape: code that leaves the factory-call grammar becomes `opaque`, shown but not rewritten. Factories imported from a `base/<block>` subpath read like the `base` barrel; a component with no catalog factory (a helper's return value) is listed opaque and preserved on save.
- A block's permission is named after its position: moving or renaming it drops role grants.
- A type error anywhere in the project blocks every write: fix it first.
- A query `AddQuery` writes is a page route served at `/dms/pages<pageRef><endpoint>`; a block's `fetchUrl` must use that address (`pageRoutePath` from `@antelopejs/interface-dms/page`).
- The builder's texts live in `frontend-vue/i18n/locales/builder-{en-GB,fr-FR}.json` (namespace `dms_builder`, English fallback) and cover the database connect flow.
- Page content rules (blocks backend-side, custom only for a missing block, `.meta()` on custom blocks) come from `dms-best-practices`.
