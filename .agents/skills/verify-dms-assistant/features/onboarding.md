---
covers:
  - src/routes/onboarding.ts
  - src/routes/owner-ui.ts
  - sidecar/src/server/onboarding.ts
  - sidecar/src/providers/login.ts
  - frontend-vue/app/onboarding/**
docs:
  - docs/1.introduction.md
---

# Onboarding

The first-run popup connects an AI and picks a starting point. Its routes tell where each login stands, take a pasted Claude token and record the provider. Driven here: those routes, offline, and the popup's connect step on a development dashboard, under `ajs project dev` with and without `-w`. The popup's AI steps, the live token check and the ChatGPT consent are under the skill's Not driven list. The database path's routes belong to `verify-dms-builder`.

## Sub-features

- `under-watch-the-connect-popup-follows-the-connection-across-a-reload-and-a-reopen-to-the-analysis` (`frontend: "dev"`, `backend: "watch"`, `last`): the owner opens the connect step (`?assistant=connect`), connects a MongoDB database of the run with a wrong password and sees the sign-in refused, connects the corrected URL, reloads the page and closes and opens the popup again while the schema is read, and the popup follows the connection to the analysis without the URL being typed again.
- `without-watch-the-connect-popup-asks-for-a-restart-and-keeps-asking-after-a-reload-and-a-reopen` (`frontend: "dev"`, `backend: "dev"`, `last`): the same connection without `-w`: the popup says to restart the project instead of reading the schema, and says it again after a reload and after it is closed and opened again, without the URL.
- `the-state-says-where-each-login-stands-and-offers-one-codex-sign-in`: the state names the provider and a boot id, says both logins are signed out, offers one ChatGPT sign-in address toward OpenAI that returns to the sidecar, answers the same address to every poll, and is never cached; a Claude credential in the environment reads as signed in from the environment, without the key in the answer.
- `a-provider-choice-is-saved-and-an-unknown-one-is-refused`: choosing Codex is saved as the settings' coding agent whether or not Codex is signed in, choosing Claude Code goes back, and a provider that does not exist answers 400 and changes nothing.
- `a-pasted-claude-token-is-checked-without-being-stored-or-echoed`: a missing token answers 400, a token not shaped like one answers `malformed` without a request to Anthropic, nothing is stored and no answer carries what was pasted.

## How to get to it (user POV)

- The assistant's first-run popup in the dashboard; the routes are `GET /ai/onboarding`, `POST /ai/onboarding/claude-token` and `POST /ai/onboarding/provider`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" onboarding
```

## Gotchas

- A run that inherits `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` would read as signed in, so the journeys blank those variables with `withEnv` before they read a login.
- The owner guard of these routes is part of the access feature's sweep.
- The connect journeys seed their source database on the run's `mongod` with the `mongodb` driver, with a read-only user: the popup refuses a URL without one ("Needs a user."). They write the connection into the run's project, so they run `last`.
- A watch backend loads `dms-assistant` from `DMS_MODULE_ROOT`, the checkout, and `app` from the checkout's `e2e/playground`, as `e2e/playground/antelope.config.ts` reads them. The run's copy of the checkout only links to the module's files, and Node caches them under their real paths, so a `-w` restart loading the copy keeps the first launch's module code: its `AddFrontendModule` call reaches no DMS, and the backend logs `Module 'dms-assistant' is still starting after 10 s`. A restart drops the cached files under a module's folder except its `node_modules` and the folders of the modules inside it, so `app` loads from the checkout too: from the copy, the restart would drop the core and `dms` from the playground's `node_modules` and never construct the modules again.
- Under `-w` the schema is read about a second after the restart, so the watch journey's reload lands in the restart. That page gets the dashboard's 502 page, which needs `@antelopejs/dms-frontend` 0.11.8 or later to load the page again once the restarted project answers. Once the analysis shows, the popup forgets the connection, so the schema check never shows `done` and a popup opened after the analysis is empty.
