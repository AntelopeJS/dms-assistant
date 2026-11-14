# Feature map

One file per feature. `covers:` lists the source globs it owns, `docs:` the pages a verdict judges, `journeys/<feature>.mjs` its journeys, and `coverage/<feature>.md` the documented behaviours and the check that pins each. `dms-control map` checks that every user-facing file is covered and that every feature has its journeys and existing docs pages.

The skill covers what this repository ships of the builder: the external database connect routes in `src/builder`, and the client, types and message catalog in `frontend-vue/builder`. The page, block, table and data source operations belong to `@antelopejs/dms`, whose own verification skill drives them (see [SKILL.md](../SKILL.md)).

| Feature | What the user does | Journeys |
|---|---|---|
| [connection-check](connection-check.md) | `POST /database/connections/check`: test a database live before connecting it, owner only and in development only. | the-check-refuses-the-owner-outside-development, the-check-validates-the-body-and-reaches-the-database-in-development |
| [database](database.md) | The `/api/builder/database` routes behind "Start from an existing database", on a project without an external database. | a-project-without-an-external-database-answers-the-documented-empties-and-404s, the-project-answer-carries-the-fields-the-connect-form-reads, writes-that-are-refused-or-dry-run-leave-the-project-untouched |
| [http-api](http-api.md) | Who may call the routes, and the `builder.api.enabled` and `builder.projectRoot` options. | every-route-needs-a-tenant-owner, the-routes-follow-api-enabled-and-the-start-mode, project-root-decides-where-the-connect-flow-writes |
| [i18n](i18n.md) | The English and French catalogs of the builder. | english-and-french-catalogs-carry-the-same-keys-under-dms-builder |
| [smoke](smoke.md) | The fixed journey every verdict runs: list the connections and read the project's modules as the owner, and see an anonymous request refused. | smoke |

The smoke journey runs on every verdict.
