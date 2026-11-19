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

The chat panel, the agent loop, the tools, approvals, change-set cards, block previews and the command palette. All of it needs a development dashboard (`import.meta.env.DEV`, `up --dev-frontend`) and a model. No run holds credentials, so the turns run on the fake Claude provider: `MOCK_CLAUDE=1` makes the sidecar load `sidecar/tests/fixtures/mock-claude` in place of the agent SDK, and it replays the SDK messages the journey scripts. What the panel and the sidecar do with a turn is driven: the message and its streamed reply, the token count, an approval, the change-set card with its Undo and Redo, and the set on the Changes page. The real SDK and model are not. Also driven: the documented absence, a production dashboard shows no assistant, and the launcher's name.

## Sub-features

- `a-production-dashboard-shows-no-assistant`: no launcher, no panel, no starters, no palette assistant on a production build.
- `a-cold-development-load-names-the-launcher-in-english-and-in-french` (`frontend: "dev"`): on a cold load of the development dashboard the header launcher is named `Assistant (Ctrl+Shift+K)` without any interaction, in English and, once the owner chose Français, in another browser in French.
- `a-message-sent-from-the-panel-gets-the-reply-claude-streams-and-its-token-count` (`frontend: "dev"`): the owner opens the panel from the launcher and sends a message; the panel shows it, the reply the fake Claude provider streams in three chunks once and whole, and the `154 tokens · this chat` the turn's result reported.
- `an-approved-edit-shows-its-change-set-card-and-the-set-on-the-changes-page` (`frontend: "dev"`): in Code mode with Ask first, Claude asks to create `notes/welcome.md`; the approval dock names the file and its path, the owner allows it, the chat shows the reply and the change-set card (`Change applied · #1`, 1 file changed, the new file), and Modules › Assistant › Changes lists the set with who asked, the approval and the file's diff.
- `the-change-set-card-undoes-the-turn-and-redoes-it-on-disk` (`frontend: "dev"`): after the same approved edit, Undo on the card removes the file from the project and the card reads `Undone · checkpoint 1 restored` with Redo; Redo writes the file back with the text Claude wrote and the card reads `Change applied · #1` again.

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
- `withMockClaude(ctx, scriptedTurn({ calls, reply, usage }), body)` in `e2e/journeys/chat/mock-claude.mjs` runs `body` on a fresh sidecar that replays the scripted turn, and writes the script into the step's evidence. The fixture is TypeScript and the run's sidecar is `sidecar/dist`, so the backend starts with `NODE_OPTIONS=--import=…/mock-claude-hooks.mjs`, which resolves the fixture's `.js` imports to its `.ts` sources for Node's type stripping, and the sidecar inherits it. Nothing is compiled: a `.js` beside the fixture would shadow its `.ts` in the sidecar's vitest runs, and nothing reaches the published package. The first check reads the sidecar's `/proc/<pid>/environ` for `MOCK_CLAUDE=1` and the script.
- The fake provider replays a tool call without running it. The change-set journeys write the file while the call waits for the owner's approval, between the snapshots the turn takes when it starts and when it ends, as the real tool would. They remove `notes/` from the run's playground before and after.
- The approval's Allow button is named `Allow edit ↵`, and the card's `Change applied` and `new` are uppercased by CSS: the journeys match them by substring and without regard to case.
- Each turn journey restarts the backend three times (`withEnv` twice, `freshSidecar` once) and takes about a minute.
- Everything else in this feature is under the skill's Not driven list.
