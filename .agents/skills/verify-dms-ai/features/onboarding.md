---
covers:
  - src/routes/onboarding.ts
  - sidecar/src/server/onboarding.ts
  - sidecar/src/providers/login.ts
  - frontend-vue/app/onboarding/**
  - frontend-vue/builder/**
docs:
  - docs/1.introduction.md
  - docs/8.database-connection.md
---

# Onboarding

The first-run popup connects an AI and picks a starting point. Its routes tell where each login stands, take a pasted Claude token and record the provider. Driven here: those routes, offline. The popup itself, the live token check, the ChatGPT consent and the database path are under the skill's Not driven list.

## Sub-features

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
