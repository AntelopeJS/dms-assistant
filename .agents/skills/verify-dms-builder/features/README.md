# Feature map

One file per feature. `covers:` lists the source globs it owns, `docs:` the pages a verdict judges, `journeys/<feature>.mjs` its journeys, and `coverage/<feature>.md` the documented behaviours and the check that pins each. `dms-control map` checks that every user-facing file is covered and that every feature has its journeys and existing docs pages.

| Feature | What the user does | Journeys |
|---|---|---|
| [blocks](blocks.md) | Blocks: add, configure, move and remove; value encodings; typecheck rollback. | add-block-writes-a-factory-call-and-refuses-what-it-cannot-write, configure-move-and-remove-rewrite-one-block, a-write-that-would-not-compile-is-rolled-back |
| [catalog](catalog.md) | `GetCatalog` and `RefreshSourceIndex`: block types, DataTypes, reserved names and the catalog cache. | the-catalog-describes-block-types-and-data-types |
| [categories](categories.md) | Menu categories: create, list, patch, delete and their refusals. | a-category-is-written-beside-the-root-barrel, configure-and-delete-follow-the-documented-refusals |
| [database](database.md) | The `/api/builder/database` routes on a project without an external database. | a-project-without-an-external-database-answers-the-documented-empties-and-404s |
| [drafts](drafts.md) | `SetPageBlocks` and `PreviewLayout`: a whole page in one transaction, validation with pointers, preserved blocks. | set-page-blocks-writes-blocks-and-queries-in-one-transaction, set-page-blocks-reports-every-problem-at-once, preserving-every-block-changes-only-the-page-metadata, preview-layout-serializes-a-draft-without-writing |
| [http-api](http-api.md) | The `/api/builder` routes and the options that switch them: owner-only access, answer shapes, `api.enabled`, `projectRoot`. | every-route-needs-a-tenant-owner, lists-answer-their-value-and-mutations-answer-an-op-result, the-builder-follows-api-enabled-and-the-start-mode, project-root-decides-where-the-builder-writes |
| [i18n](i18n.md) | The English and French catalogs of the builder. | english-and-french-catalogs-carry-the-same-keys-under-dms-builder |
| [package](package.md) | What the module and the interface publish, and the shipped skill. | the-module-and-the-interface-tarballs-hold-what-their-manifests-name, the-skill-cases-name-existing-skills |
| [pages](pages.md) | Pages: create from a name, patch metadata, move between categories, delete, with versions for conditional writes. | create-page-writes-the-file-and-wires-the-barrel, configure-a-page-patches-and-moves-it, delete-a-page-removes-its-file-and-import |
| [queries](queries.md) | Data sources: templates, `AddQuery`, `ConfigureQuery`, `RemoveQuery` and `PreviewQuery` on the seeded orders. | preview-query-answers-exact-figures-from-the-seeded-orders, preview-validates-parameters-as-add-query-does, add-configure-and-remove-a-query-write-a-route-and-a-model-method |
| [resources](resources.md) | Tables and their DataAPI: create, fields, routes, delete. | create-resource-writes-a-table-a-controller-and-an-index, an-exported-field-is-written-with-its-import, fields-and-routes-are-edited-in-both-generated-files, delete-resource-removes-its-files-imports-and-rows |
| [smoke](smoke.md) | The fixed journey every verdict runs: retitle a card through `POST /page/blocks`, read the change in the source, the structure API and on the page. | smoke |

The smoke journey runs on every verdict.
