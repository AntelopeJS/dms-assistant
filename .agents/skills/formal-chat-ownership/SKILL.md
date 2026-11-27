---
name: formal-chat-ownership
description: Bounded exhaustive check that every message type the sidecar's chat socket accepts, sent by one person on another person's conversation, changes none of its state, tells the sender nothing about it and reaches none of the owner's sockets. Use when a change touches the chat socket's handlers, the conversation owner check, the permission or question buses, the host state or the navigation completer, or adds a client message type.
---

# Formal check: chat requests honour the conversation owner

A conversation belongs to the person who started it. Every chat socket request that names a conversation, or a request id that belongs to one, must refuse another person: change nothing, leak nothing, reach none of the owner's sockets. Tests pinned one request type at a time, and each of #57, #59 and #61 found the next type that skipped the check. This check drives every message type the protocol defines, so a new type cannot ship unclassified.

The tool is Vitest on the real sidecar, not a hand model: the harness starts the real HTTP and WebSocket stack with a mocked provider, Camille owns a conversation, Dana sends each request, and the check compares everything Camille can observe before and after. Message types and their frames are listed in `sidecar/tests/formal/chat-ownership-scopes.ts`; the driver is `sidecar/tests/formal/chat-ownership.test.ts`.

## Run it

```sh
node .agents/skills/formal-chat-ownership/check.mjs
```

It prints nothing and exits 0 when every rule holds and every recorded defect still fails. Exit 1 means a rule changed, 2 means the tests could not run. `pnpm test` runs it through `tests/formal-chat-ownership.test.cjs`, so `pnpm run checks` covers it. The sidecar's own Vitest job runs the same file. A run takes about 30 s and needs no Java.

## The property

For each message type, in a world where Camille's conversation has a turn paused on a permission prompt, a pending question and a queued follow-up (`paused`), or a finished turn with a change set and a standing rule (`settled`), every frame in `SCOPES` that Dana sends must:

1. leave Camille's observable state as it was: the stored conversation, its closure, the queue, the rules, the pending prompts and questions, the modes, whether a turn runs, the auto-fix flag, the change sets, Camille's current page, and the navigation and block reports her agent waits for;
2. tell Dana only the refusal `This conversation belongs to someone else.` or nothing: no frame of hers may carry the conversation id, Camille's text or request ids;
3. send nothing to Camille's chat socket or to Camille's host socket.

Answers by request id (`permission_response`, `question_response`) count as conversation requests: the owner is looked up from the request. Types with no conversation and no request id (`echo`, `actor`, `set_settings`) are classified `none` with the reason.

A request on the sender's own conversation can still reach the owner's state. An undo with the later change sets (`includeLater`) takes the later sets that touch the same files, and those can belong to another person's conversation. A case of its own checks it: Dana records a change set, Camille one on the same file, then Dana another; Dana's Undo preview (`GET /changes/:id/undo-preview?viewer=<her id>`, what the chat's dialog lists) names only her later set, then Dana undoes her first with the later sets, and both of hers end undone while Camille's stays applied. It fails a preview or an undo that takes every later set (the code before this case) and one that takes none.

## What it covers

Bounds: two people, one conversation, one frame at a time, two worlds, 21 message type cases. Not covered: two requests racing, a request sent while the owner's turn ends, the `hello` of a socket whose conversation does not exist yet (`conversation-answers-and-delete.test.ts` pins it), host commands that a turn sends (`per-owner-page.test.ts`, `host-command-router.test.ts`), and the HTTP routes (`access.md` sweeps them).

## Findings at the sync commit

None since #150. A finding is a case marked `defect` in `SCOPES`: it runs as `it.fails`, so the check passes while the defect exists and turns red the day it is fixed. Remove the `defect` field then.

## Before the fixes

The check fails on the code before each fix (`git worktree add` the parent commit, install, copy the two test files in `sidecar/tests/formal`, run `pnpm --dir sidecar exec vitest run tests/formal/chat-ownership.test.ts`; the check reads `closure` through `in` so it also runs there):

| Code | Failing cases |
| --- | --- |
| before #57 (`f295038^`) | `permission_response`, `question_response`, `host_state_update`, `interrupt_turn`, `queue_cancel`, `queue_update`, `queue_move`, `queue_clear`, `revoke_rule`, `set_conversation_mode`, `stop_autofix` |
| before #59 (`8da2039^`) | `permission_response`, `question_response`, `host_state_update` |
| before #61 (`1baa062^`) | `host_state_update` |
| before #150 (`229c83c`) | `change_set_action`, `host_navigation_complete`, `host_page_blocks` |
| before Wa4f5503c-81 (`3ad6035`) | the undo with the later change sets |
| before Wa4f5503c-162 (`b122d6a`) | the preview of the later change sets |

## Real bug or modeling error

Read the assertion message: it names the frame and what it changed. Replay the same frame by hand with `startWsHarness` as `foreign-conversation-requests.test.ts` does. A failure is a modeling error only when the frame cannot reach a handler that way in production, for example a socket that has no actor. Then fix the case and say why in this file. Never drop a message type to make the check pass: classify it `none` with a reason, or fix the handler.

## Changing the check

- A new client message type: add it to `SCOPES` (the typecheck fails until you do), with a frame and a world.
- A new thing the owner can observe: add it to `observe` in `chat-ownership.test.ts`.
- A fixed defect: delete its `defect` field, and its line above.
- Sync commit: `ad5c6f8`. The covered files:

```sh
git diff --stat ad5c6f8 -- sidecar/src/server/routing.ts sidecar/src/server/host-command-router.ts sidecar/src/server/navigation-completer.ts sidecar/src/state/host-state.ts sidecar/src/server/change-set-actions.ts sidecar/src/protocol/messages.ts
```

Move the sync commit forward only after you confirm the check describes the code at the new commit.

| Case | Code |
| --- | --- |
| every conversation request | `admit`, `refusalOf` and the handlers in `sidecar/src/server/routing.ts` |
| answers by request id | `mayAnswer`, `permissionBus.conversationOf`, `questionBus.conversationOf` |
| host messages | `handleHostStateUpdate`, `handleHostNavigationComplete`, `handleHostPageBlocks`, `createHostState`, `createNavigationCompleter` |
| change sets | `handleChangeSet`, `changeSetRefusalOf`, `handleChangeSetAction` |
| undo with the later sets | the `mayUse` that `handleChangeSet` passes to `handleChangeSetAction`, `undo` in `sidecar/src/checkpoints/checkpoints.ts` |
| preview of the later sets | `previewedBy` in `sidecar/src/server/http-routes.ts`, `conversationRefusal` in `sidecar/src/server/message-gate.ts`, `undoPreview` in `sidecar/src/checkpoints/checkpoints.ts` |
