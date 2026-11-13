# Coverage: connection-check

Docs: `docs/8.database-connection.md`. Journeys: `journeys/connection-check.mjs`.

| Source | Documented behaviour | Journey | Check / Not driven |
| --- | --- | --- | --- |
| docs/8.database-connection.md:64 | The check is owner only, and answers 403 outside development | the-check-refuses-the-owner-outside-development | the owner gets 403 `forbidden` under `ajs project start`, for a good body and a bad one; the owner-only part is in http-api |
| docs/8.database-connection.md:64 | 400 for an `engine` other than `postgres`, `mongodb` or `rethinkdb`, or a `url` that is not of that engine | the-check-validates-the-body-and-reaches-the-database-in-development | an unknown engine, a URL of another engine and a missing URL answer 400, the message names the engines and the field, and none repeats the password |
| docs/8.database-connection.md:143 | `reachable` is true when a server answered, with `latencyMs` | same | the run's MongoDB answers `reachable: true` and a numeric `latencyMs` |
| docs/8.database-connection.md:144 | `canRead` and `canWrite`; a MongoDB without access control gives full privileges | same | `canRead` and `canWrite` true on the run's mongod |
| docs/8.database-connection.md:145 | `reason` is present when the database is unreachable and never holds the URL or the password | same | a MongoDB nothing listens on answers `reachable: false` with a reason, no password and no `mongodb://` |
| docs/8.database-connection.md:139 | When the client library is installed in neither place the answer is `reachable: false` with `Install pg to connect a PostgreSQL database.` | - | Not driven: the repository installs every client library |
| docs/8.database-connection.md:143 | `reachable` is true when a server answered, even to refuse the sign-in; a refused account reports `canRead` false | - | Not driven: the run's mongod has no access control |
| docs/8.database-connection.md:147 | A RethinkDB URL with no database after the port is answered once the account has signed in | - | Not driven: no RethinkDB server in the run |
| docs/8.database-connection.md:149 | The check ends within three times the connect timeout and closes every connection it opened | - | Not driven: a server that ignores the goodbye needs a socket that does not answer; the Mocha specs `database-check-*.spec.ts` in `src/builder/test` pin it |
| docs/8.database-connection.md:139 | The check works for PostgreSQL and RethinkDB | - | Not driven: the run starts a MongoDB only; the Mocha specs `database-check-postgres.spec.ts` and `database-check-rethinkdb.spec.ts` pin them |
