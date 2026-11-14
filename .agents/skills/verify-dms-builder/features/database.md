---
covers:
  - src/builder/routes/database.ts
  - src/builder/constants/routes.ts
  - src/builder/implementations/**
  - frontend-vue/builder/app/runtime/**
docs:
  - docs/8.database-connection.md
---

# External databases

The `/api/builder/database` routes behind the onboarding's "Start from an existing database" path, the engine files they reach, and the client and types in `frontend-vue/builder` that call them. The analysis and the mapping of a real external database need a catalog provider and a database the run does not hold, so the journeys drive the empty, shape and refusal paths.

## Sub-features

- `a-project-without-an-external-database-answers-the-documented-empties-and-404s`: the connection list is empty, and an unknown connection, analysis, sample or mapping answers 404 or a not_found refusal.
- `the-project-answer-carries-the-fields-the-connect-form-reads`: `GET /database/project` answers the modules, this module's id, the own database and the pins that the client's `ProjectModules` type reads.
- `writes-that-are-refused-or-dry-run-leave-the-project-untouched`: refused writes, a dry run with and without `variables` and a repair with nothing to repair answer as documented and leave `antelope.config.ts` and `.env` as they were.

## How to get to it (user POV)

- Pick "Start from an existing database" in the assistant's onboarding popup, which calls these routes. The popup opens that form only behind a working Claude or Codex sign-in, which a run never holds, so the journeys call the routes the way the popup's client does.

## Driving it with dms-control

```bash
dms-control journey "$RUN" database
```
