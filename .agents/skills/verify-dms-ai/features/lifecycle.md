---
covers:
  - src/lifecycle/**
  - src/constants/project-mcp.ts
  - src/routes/health.ts
  - src/routes/sidecar-info.ts
  - src/routes/status.ts
  - src/routes/status-shapes.ts
  - src/routes/banner.ts
  - src/routes/content-json.ts
  - src/routes/sidecar-results.ts
  - src/types/status.ts
  - sidecar/src/index.ts
  - sidecar/src/server/idle-shutdown.ts
  - sidecar/src/server/routing.ts
  - sidecar/src/server/services.ts
  - sidecar/src/state/sidecar-version.ts
  - sidecar/src/server/http.ts
  - sidecar/src/server/http-io.ts
  - sidecar/src/server/http-params.ts
  - sidecar/src/server/http-routes.ts
  - sidecar/src/state/lock.ts
docs:
  - docs/2.installation.md
  - docs/6.faq.md
---

# Lifecycle

The backend starts the sidecar as a child process, reports its status, restarts it, gives up after repeated crashes, and starts none with `DMS_AI=0`.

## Sub-features

- `the-status-reads-ready-and-names-the-sidecar`: the status, its rows and its banner describe a ready assistant, the probe says the sidecar runs, and the health route answers without a session.
- `a-restart-gives-a-new-sidecar-and-keeps-what-you-set`: Restart assistant stops the sidecar and starts another on a new port, and the settings stay.
- `a-sidecar-that-keeps-dying-gives-up-and-the-banner-offers-a-restart`: a killed sidecar is restarted until the budget is spent, then the Settings banner says it is offline with Restart assistant.
- `the-sidecar-listens-on-loopback-only`: the socket is bound to 127.0.0.1 and the machine's network address is refused.
- `an-openai-api-key-is-ignored-with-one-warning-per-start`: the documented warning, once per start, absent without the variable.
- `an-idle-sidecar-exits-after-its-idle-timeout-and-the-next-probe-starts-it`: with `DMS_AI_IDLE_SHUTDOWN_MS` at 20 seconds, a sidecar only the backend talks to exits one timeout after it started (the start arms the timer); the next probe starts another, and a direct `/health` made a third of the timeout in postpones its exit by a whole timeout (the health check touches the timer).
- `dms-ai-0-starts-the-backend-without-a-sidecar`: DMS_AI=0 leaves the status offline and disabled, the banner without a button, and the routes that need the sidecar answering 503.
- `a-backend-that-crashed-leaves-no-sidecar-for-long`: stopping the project stops the sidecar, and a sidecar left by a killed backend is stopped by the next start.

- `a-development-start-replaces-the-old-dms-ai-server-in-mcp-json`: the development start (the journey pins `backend: "dev"`, the run's other journeys run `ajs project start`) removes the `dms-ai` server of the previous version from the project's `.mcp.json`, keeps every other server and key, leaves the `dms` server in place, writes nothing on the next start, keeps a `dms-ai` server of the owner's own whose launcher is another, and leaves a file that is not a JSON object of servers as it is, with a warning.

## How to get to it (user POV)

- Modules › Assistant › Settings, the banner; `DMS_AI=0` before `ajs project start`; `.mcp.json` at the project root after a development start.

## Driving it with dms-control

```bash
dms-control journey "$RUN" lifecycle
```

## Gotchas

- The sidecar lives in the playground's `node_modules/.cache/dms-ai`, so a checkout holds one run at a time. A standby backend would share it, so the run must start with `up --no-standby`: `guarded` ends every journey with a NOT VERIFIED error on a run that did not.
- The `.mcp.json` journey does not read the sidecar's folder. The DMS writes the `dms` server itself in development, so the journey judges the end state, not which module added it.
- A sidecar that idles for 15 minutes exits. The journeys finish well inside that, and the idle journey drives the same timer with `DMS_AI_IDLE_SHUTDOWN_MS`, a positive integer of milliseconds the sidecar reads at start; the 15-minute default itself is not waited for.
