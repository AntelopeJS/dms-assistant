# Coverage: smoke

Docs: `docs/8.database-connection.md`. Journeys: `e2e/builder/journeys/smoke.mjs`.

| Source | Documented behaviour | Journey | Check / Not driven |
| --- | --- | --- | --- |
| docs/8.database-connection.md:54 | `GET /api/builder/database/connections` answers the catalog connections of the project, `[]` before you connect one | smoke | 200 and an empty array for the owner |
| docs/8.database-connection.md:69 | `GET /database/project` answers the configured modules and `self` | smoke | 200, the playground among the modules, `self` is `dms-assistant` |
| docs/8.database-connection.md:9 | Every route requires an authenticated tenant owner | smoke | an anonymous read answers 401 |
