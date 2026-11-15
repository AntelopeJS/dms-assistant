---
covers:
  - src/builder/routes/database.ts
  - src/builder/refusal.ts
  - src/builder/dms-answer.ts
docs:
  - docs/8.database-connection.md
---

# Connection check

`POST /api/builder/database/connections/check`: the live test of a database before the connection is written. The route asks `CheckDatabaseConnection` of `@antelopejs/dms`, which runs the `probe` of the engine's driver package, for the owner and in development only.

## Sub-features

- `the-check-refuses-the-owner-outside-development`: under `ajs project start` the owner gets 403 `forbidden`, for a good body and a bad one, and no answer repeats the URL.
- `the-check-validates-the-body-and-reaches-the-database-in-development`: under `ajs project dev` (the journey pins `backend: "dev"`) nobody and a member who is not the owner are refused without the database being reported, a body that is not an engine and its URL answers 400 without echoing the URL, the run's own MongoDB answers `reachable` with read and write access, and a MongoDB nothing listens on answers `reachable: false` with a reason that holds no password.

## How to get to it (user POV)

- Fill the engine and the URL in "Start from an existing database" and press "Connect and analyse": the popup's first step is this check. The journeys send the same request.

## Driving it with dms-control

```bash
dms-control journey "$RUN" connection-check
```
