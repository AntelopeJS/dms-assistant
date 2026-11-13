---
covers:
  - src/routes/actor.ts
  - src/routes/index.ts
  - src/routes/sidecar-auth.ts
  - sidecar/src/server/http.ts
  - src/index.ts
  - sidecar/src/constants/mcp.ts
  - sidecar/src/constants/preview.ts
  - sidecar/src/constants/logs.ts
  - sidecar/src/constants/database.ts
  - sidecar/src/mcp/tool-definitions.ts
  - sidecar/src/server/http-io.ts
  - sidecar/src/constants/http.ts
  - sidecar/src/state/lock.ts
  - sidecar/src/mcp/http-binding.ts
  - src/routes/sidecar-answers.ts
  - src/routes/logs.ts
  - src/routes/pages-registry.ts
  - src/pages-registry.ts
  - src/logging/**
  - src/sidecar/**
  - sidecar/src/server/client-auth.ts
docs:
  - docs/5.extending.md
  - docs/3.configuration.md
---

# Access

Every route of the module answers the owner. The sidecar calls its own routes with a token only it holds, and the dashboard's server forwards `/ai/**` to the backend. The external database connect routes under `/api/builder/database` belong to `verify-dms-builder`.

## Sub-features

- `every-owner-route-refuses-nobody-and-a-member`: 401 without a session, 403 to a member, the owner let in, nothing changed by the refusals. The sweep holds the Settings, Activity, Changes, Codex account and onboarding routes.
- `the-sidecar-routes-answer-only-the-sidecar`: logs and the pages registry refuse anyone but the holder of the sidecar's token (an owner session, nobody, a wrong token, the browser's client credential); health needs no sign-in.
- `the-dashboard-origin-forwards-ai-with-the-session`: the dashboard's origin forwards `/ai/**` with the session.

The DMS's own MCP server, `.mcp.json` and bridge belong to `@antelopejs/dms`: this module no longer serves `/ai/mcp`, the Builder routes or the database routes of the sidecar.

## How to get to it (user POV)

- Any page of the Assistant; the routes are the ones the pages call.

## Driving it with dms-control

```bash
dms-control journey "$RUN" access
```

## Gotchas

- The sidecar's token is read from the lock file the sidecar publishes, as the backend does.
- `GET /ai/channel/events` is a stream: the owner sweep only reads its refusals and skips it for the owner.
