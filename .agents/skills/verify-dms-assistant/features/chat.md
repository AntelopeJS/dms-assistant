---
covers:
  - frontend-vue/dms.frontend.ts
  - frontend-vue/app/plugins/**
  - frontend-vue/app/runtime/**
  - frontend-vue/app/chat/**
  - frontend-vue/app/components/**
  - frontend-vue/i18n/**
  - src/channels/**
  - src/routes/channels.ts
  - src/routes/sidecar-info.ts
  - sidecar/src/agent/**
  - sidecar/src/mcp/**
  - sidecar/src/prompts/**
  - sidecar/src/providers/claude/**
  - sidecar/src/providers/registry.ts
  - sidecar/src/providers/types.ts
  - sidecar/src/protocol/**
  - sidecar/src/server/chat-events.ts
  - sidecar/src/server/chat-socket-registry.ts
  - sidecar/src/server/conversation-runs.ts
  - sidecar/src/server/host-command-router.ts
  - sidecar/src/server/host-page.ts
  - sidecar/src/server/host-socket-registry.ts
  - sidecar/src/server/live-turns.ts
  - sidecar/src/server/navigation-completer.ts
  - sidecar/src/server/pending-queue.ts
  - sidecar/src/server/permission-events.ts
  - sidecar/src/server/raw-data.ts
  - sidecar/src/server/safety-net.ts
  - sidecar/src/server/tool-calls.ts
  - sidecar/src/server/turn-progress.ts
  - sidecar/src/server/turn-registry.ts
  - sidecar/src/server/turns.ts
  - sidecar/src/server/ws.ts
  - sidecar/src/state/conversations.ts
  - sidecar/src/state/host-state.ts
  - sidecar/src/state/store.ts
  - sidecar/src/state/types.ts
  - sidecar/src/state/safe-segment.ts
  - sidecar/src/builder/**
  - sidecar/src/pages/**
  - sidecar/src/logs/**
  - sidecar/src/host/**
  - sidecar/src/constants/**
docs:
  - docs/4.usage/1.chat.md
  - docs/7.preview-constraints.md
  - docs/1.introduction.md
---

# Chat

The chat panel, the agent loop, the tools, approvals, change-set cards, block previews and the command palette. All of it needs a development dashboard (`import.meta.env.DEV`) and a model, and no run holds credentials. Two things are driven: the documented absence, a production dashboard shows no assistant, and the launcher's name on a development dashboard (`up --dev-frontend`).

## Sub-features

- `a-production-dashboard-shows-no-assistant`: no launcher, no panel, no starters, no palette assistant on a production build.
- `a-cold-development-load-names-the-launcher-in-english-and-in-french` (`frontend: "dev"`): on a cold load of the development dashboard the header launcher is named `Assistant (Ctrl+Shift+K)` without any interaction, in English and, once the owner chose Français, in another browser in French.

## How to get to it (user POV)

- The sparkle Assistant button of the header or `Ctrl` `Shift` `K`, in the development dashboard only.

## Driving it with dms-control

```bash
dms-control journey "$RUN" chat                 # on a run of up
dms-control journey "$DEV_RUN" chat             # on a run of up --dev-frontend
```

## Gotchas

- A development dashboard opens the onboarding popup on every page: the launcher journey ticks its "Don't show on startup" before any page script runs.
- The launcher journey does not reproduce the race #62 fixed (the locale catalog arriving after the launcher registered): on this dashboard the catalog loads before the launcher registers, even when the browser holds it back.
- Everything else in this feature is under the skill's Not driven list.
