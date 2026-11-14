---
covers:
  - src/builder/index.ts
  - src/builder/config.ts
  - src/builder/frontend-module.ts
  - src/builder/routes/index.ts
  - frontend-vue/builder/app/runtime/api.ts
  - frontend-vue/builder/app/runtime/constants.ts
  - frontend-vue/builder/app/runtime/enabled.ts
docs:
  - docs/8.database-connection.md
---

# Access and configuration

Who may call the `/api/builder/database` routes, and the options that switch them: every route needs an authenticated tenant owner, `builder.api.enabled` decides whether they are mounted, by default from the core's development flag, and `builder.projectRoot` names the source root they write under.

## Sub-features

- `every-route-needs-a-tenant-owner`: anonymous requests and a member who is not the owner are refused on all thirteen routes, the owner reaches them, and a refused request writes nothing.
- `the-routes-follow-api-enabled-and-the-start-mode`: under `ajs project start` the routes answer only with `builder.api.enabled` true; left unset or false they answer 404 and the dashboard still serves its page.
- `project-root-decides-where-the-connect-flow-writes`: a dry run of `ConfigureProject` names the configuration file under `builder.projectRoot`, and a relative root resolves against the process working directory.

## Driving it with dms-control

```bash
dms-control journey "$RUN" http-api
```
