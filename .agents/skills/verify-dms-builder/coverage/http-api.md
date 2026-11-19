# Coverage: http-api

Docs: `docs/8.database-connection.md`. Journeys: `e2e/builder/journeys/http-api.mjs`.

| Source | Documented behaviour | Journey | Check / Not driven |
| --- | --- | --- | --- |
| docs/8.database-connection.md:9 | Every route requires an authenticated tenant owner | every-route-needs-a-tenant-owner | anonymous and a member get 401 or 403 on all fourteen routes, the owner reaches the thirteen it can; a refused request leaves `antelope.config.ts` unchanged |
| docs/8.database-connection.md:18 | `builder.api.enabled` mounts the routes, or keeps them off | the-routes-follow-api-enabled-and-the-start-mode | forced on under `start`: connections 200; forced off: 404 |
| docs/8.database-connection.md:46 | `ajs project start` leaves the routes off: they answer 404 | same | with `api.enabled` unset (the module's default) connections and project answer 404 and the Board page still renders |
| docs/8.database-connection.md:41 | When `api.enabled` is unset the routes follow the core's development flag | same | the `start` side. Not driven: the `dev` side with the option unset, because the playground forces the option on in every other journey |
| docs/8.database-connection.md:17 | `builder.projectRoot` is the app's source root and a relative path resolves against the working directory | project-root-decides-where-the-connect-flow-writes | the default is the run's playground; an absolute root names the configuration file under it; a relative root resolves to an absolute path, not the literal dot |
| docs/8.database-connection.md:36 | The module does not read a `factoring` option | - | Not driven: absence of a read cannot be observed |
| frontend-vue/builder/app/runtime/enabled.ts | The frontend takes the builder as on from the registration it is served with | - | Not driven: the registration is read by the dashboard build; the Vitest suite pins `isBuilderEnabled` |
