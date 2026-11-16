---
covers:
  - src/routes/settings.ts
  - src/routes/owner-ui.ts
  - frontend-vue/app/components/GuardRails.vue
  - frontend-vue/app/views/guard-rails.ts
  - frontend-vue/app/views/composables/useGuardRails.ts
  - src/routes/metrics.ts
  - src/routes/metric-shapes.ts
  - src/types/metrics.ts
  - sidecar/src/metrics/**
  - sidecar/src/skills/**
  - sidecar/src/constants/skills.ts
  - src/sidecar/settings-values.ts
  - src/pages/settings/**
  - sidecar/src/state/settings-store.ts
  - sidecar/src/state/settings-types.ts
  - sidecar/src/constants/settings.ts
  - sidecar/src/state/store.ts
  - sidecar/src/state/conversations.ts
docs:
  - docs/4.usage/2.settings.md
---

# Settings

The Settings page, the landing page of the module, holds the defaults of new conversations in a form with two sections, AI and Builder, then the Guard rails card, with the token usage below. The card keeps one default approval mode per agent (`defaultModeClaude`: Ask first, Auto review, Accept edits or Plan only, Auto review by default; `defaultModeCodex`: Ask first, Accept edits or Plan only, Ask first by default), the Safe mode switch (the stored scope `generationMode`: `safe` or `vibe`, enabled because the DMS carries the Builder), the asks and machine-local skills. `PUT /ai/settings` writes those guard rails only for a request that carries the assistant UI's header `x-dms-ui-assistant: 1`, and the other fields without it. Each change saves as it is made and survives a restart.

## Sub-features

- `the-defaults-are-the-documented-ones`: a new install answers the documented defaults and says what the install can do.
- `every-setting-saves-alone-and-survives-a-restart`: each field, each agent's default mode included, saves on its own (the form's fields without the header, each guard rail with it) and survives a sidecar restart and a backend restart.
- `a-guard-rail-needs-the-assistant-uis-header`: the owner's `PUT /ai/settings` of a guard rail (each form: a default mode, `safeMode`, `generationMode`, `defaultModes`, an ask, local skills, an unknown key) without the header answers 403 `forbidden` and changes nothing, a free key mixed with one is refused whole, a free key saves without the header, and the same guard rail with the header saves.
- `a-stored-settings-file-is-read-back-by-the-next-start`: a settings file left by an earlier run is read when the assistant starts; wrong values and unknown keys are ignored, a mode the agent has not keeps its default, and the retired single `mode` is ignored and not served, so a file that holds only it starts both agents on their defaults.
- `the-safe-mode-switch-saves-the-stored-scope`: the Safe mode switch `safeMode` reads and writes the stored `generationMode`, the switch itself never reaches the sidecar, and a value that is not a boolean is refused.
- `a-value-outside-the-options-is-refused-and-changes-nothing`: values outside Deny after (5, 15, 30), Undo history (7, 30, 90), Claude Code's modes, Codex's modes (no Auto review) and the other options answer 400, nothing changes, an unknown field (the retired `mode` included) is ignored and the deletions switch cannot be turned off.
- `the-page-saves-each-change-as-you-make-it`: a choice, a switch and a menu save at once, each agent's default mode and every guard rail through the Guard rails card, which sends the header, and a reload shows them kept.
- `the-page-disables-what-this-machine-cannot-do`: signed out, Codex is disabled with its reason (Sign in with ChatGPT below), Codex's modes have no Auto review, no Full auto is offered, Safe mode is enabled and on, and deletions are locked on.
- `the-menus-and-choices-offer-exactly-the-documented-options`: Deny after and Undo history list exactly three options; the four radio groups (the agent, Thinking, Claude Code's four modes, Codex's three) and the six switches (the five of the Guard rails card, and Notify me) hold the documented choices.
- `every-label-of-the-page-is-the-documented-one`: each section (AI, Builder, Guard rails, Usage), setting, option, hint and banner label, in order.
- `usage-counts-nothing-before-a-conversation`: the Usage section counts zero before any turn ran.
- `usage-counts-the-stored-tokens-of-the-last-14-days`: 1,700 tokens over 3 conversations, the first of the 14 days counted and the day before left out, the biggest conversation named.

## How to get to it (user POV)

- Modules › Assistant › Settings.

## Driving it with dms-control

```bash
dms-control journey "$RUN" settings
```

## Gotchas

- The settings live in the sidecar's folder, not in the database, so each journey starts by clearing that folder (`freshSidecar`).
