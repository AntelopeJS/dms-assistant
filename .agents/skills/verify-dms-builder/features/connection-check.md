---
covers:
  - src/builder/routes/database-check.ts
  - src/builder/implementations/dms-builder/engine/access-mongodb.ts
  - src/builder/implementations/dms-builder/engine/access-postgres.ts
  - src/builder/implementations/dms-builder/engine/database-access.ts
  - src/builder/implementations/dms-builder/engine/database-check.ts
  - src/builder/implementations/dms-builder/engine/probe-client.ts
  - src/builder/implementations/dms-builder/engine/probe-connections.ts
  - src/builder/implementations/dms-builder/engine/probe-mongodb.ts
  - src/builder/implementations/dms-builder/engine/probe-postgres.ts
  - src/builder/implementations/dms-builder/engine/probe-rethinkdb.ts
  - src/builder/implementations/dms-builder/engine/rethinkdb-client.ts
docs:
  - docs/8.database-connection.md
---

# Connection check

`POST /api/builder/database/connections/check`: the live test of a database before the connection is written. It opens the database itself with the engine's client library, for the owner and in development only.

## Sub-features

- `the-check-refuses-the-owner-outside-development`: under `ajs project start` the owner gets 403 `forbidden`, for a good body and a bad one, and no answer repeats the URL.
- `the-check-validates-the-body-and-reaches-the-database-in-development`: under `ajs project dev` (the journey pins `backend: "dev"`) a body that is not an engine and its URL answers 400 without echoing the URL, the run's own MongoDB answers `reachable` with read and write access, and a MongoDB nothing listens on answers `reachable: false` with a reason that holds no password.

## How to get to it (user POV)

- Fill the engine and the URL in "Start from an existing database" and press "Connect and analyse": the popup's first step is this check. The journeys send the same request.

## Driving it with dms-control

```bash
dms-control journey "$RUN" connection-check
```
