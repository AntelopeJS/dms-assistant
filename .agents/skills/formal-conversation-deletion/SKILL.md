---
name: formal-conversation-deletion
description: TLA+ model of one conversation id against delete, a turn admitted or running through the delete, the auto-fix pass, a restart and another person's first message, checked with TLC, plus replays of its counterexamples on the real conversation store. Use when a change touches the conversation store's delete, closure or claim, the deleted table in state.json, the ownership check, or how a turn starts and writes.
---

# Formal check: deleted conversations stay closed

Deleting a conversation is the owner's promise that it is gone. A turn that still runs, an auto-fix pass, a restart or another person's first message must not bring the id back, give it a new owner or start a turn under it. #59 found a deleted conversation that came back with no owner when its turn wrote again, and #60 found four more paths, among them a restart that let another person claim the id. Tests pin one order each. This check lets TLC try every order of the steps below within the bounds.

`ConversationDeletion.tla` models one id and two people. Its actions are one step of the code each: `Admit` (admit and `noteAsker`, the claim), `Begin` (`streamTurn` start), `TurnWrite` (a turn event writing through `ensureConversation`), `TurnEnd`, `AutoFixBegin` (an auto-fix pass starts a turn with no admit), `Delete` (admit, then `forgetConversation`) and `Restart`.

## Run it

```sh
node .agents/skills/formal-conversation-deletion/check.mjs
```

It needs Node 24 and Java 11 or later from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image. The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` and checks its SHA-256. A run takes a few seconds (41, 91 and 171 states) and then replays two traces in Vitest. `pnpm test` runs it through `tests/formal-conversation-deletion.test.cjs`, so `pnpm run checks` covers it.

- Exit 0: `Current` holds every rule, and each finding still breaks with its recorded counterexample length.
- Exit 1: a rule changed. `BROKEN` names a rule that held and now breaks, `CHANGED` a finding whose shortest counterexample changed, `HOLDS` a finding that no longer breaks, or a replay failed.
- Exit 2: TLC, Java or Vitest could not run.

## The rules

| Rule | Plain sentence |
| --- | --- |
| `TypeOK` | Every variable keeps its type. |
| `DeletedStaysDeleted` | Once deleted, the id holds no record: no write, claim or list entry brings it back, so it is in nobody's list and nobody owns it. |
| `NoTurnStartsAfterDelete` | Once deleted, no turn, an auto-fix pass included, starts under the id. |

The harm: a conversation the owner deleted reappears with no owner, open to everyone, or another person owns the id, or a provider session starts under an id the owner closed.

## The configs

Each boolean constant is one behaviour of the code, true where the code has it today.

| Constant | Code |
| --- | --- |
| `DeleteClosesId` (#59) | `deleteConversation` records the id in `state.deleted`, and `closureOf` and `ensureConversation` refuse it |
| `OwnerlessClosed` (#59) | `isVisibleTo` hides a record with no owner once it holds messages |
| `PersistDeleted` (#60) | `snapshotState` and `loadCacheFromDisk` save and read the `deleted` table |
| `TurnChecksOpen` (#60) | `assertOpen` in `streamTurn`, at its start and at each event |
| `DeleteStopsAutoFix` (#60) | `forgetConversation` calls `turns.stopAutoFix` |

| Config | What it is | Result |
| --- | --- | --- |
| `Current.cfg` | all true: the code today | every rule holds |
| `Before60.cfg` | the code after #59 and before #60 | `DeletedStaysDeleted` breaks in 5 states: `Admit, Delete, Restart, Admit`; `NoTurnStartsAfterDelete` in 4: `Admit, Delete, Begin` |
| `Before59.cfg` | the code before #59 | `DeletedStaysDeleted` breaks in 5 states: `Admit, Begin, Delete, TurnWrite`; `NoTurnStartsAfterDelete` in 4 |

`check.mjs` records the lengths in its `findings`. A finding that stops breaking, or breaks in another number of states, fails the check: either the model drifted or an old behaviour came back.

## Replays on the real code

`sidecar/tests/formal/conversation-deletion.test.ts` replays the two counterexamples against `createConversationStore`, one store call per model action, and asserts the model's rule. On the code before #59 (`f295038`) both fail; before #60 (`4cfb2c3^`) the restart replay fails; today both pass. The turn-level paths (`Begin`, `AutoFixBegin` and `TurnWrite` with `TurnChecksOpen`) are pinned in the real code by `closed-conversation-turns.test.ts` only, not replayed here.

## What it covers

Bounds: one id, two people, up to two stored messages, any order of the actions. Not modeled: the 30-day retention (the rules hold within it; `pruneDeleted` forgets an id after it), a crash that loses the debounced write (`Restart` is a graceful one, which flushes), several conversations, set-aside ids, and the permission or question buses.

## Real bug or modeling error

A counterexample is a sequence of actions. Replay it against `createConversationStore` and the routing handlers, as `closed-conversation-turns.test.ts` does. It is a modeling error only when the code cannot produce that order, most likely because two model actions are one synchronous run in the code. Then fix the model, keep the rule, and say why here. Never weaken a rule to make `Current` pass.

Read each TLC result with the pstack `/statechart` skill, on a copy of the `.tla` and `.cfg` files in a scratch folder.

## Changing the model

- An intended code change: edit the action that maps to it, keep its comment naming the code, rerun.
- A new behaviour: add a boolean constant, set it in all three configs, and add its row above.
- A new finding goes into `check.mjs` with its length and into the table above.
- Sync commit: `ad5c6f8`. To see whether the model needs another look:

```sh
git diff --stat ad5c6f8 -- sidecar/src/state/conversations.ts sidecar/src/state/store.ts sidecar/src/server/routing.ts sidecar/src/server/turns.ts sidecar/src/server/conversation-runs.ts
```

Move the sync commit forward only after you confirm the model describes the code at the new commit.

## Coverage record

| Model action | Code |
| --- | --- |
| `Admit`, `Claim`, `Visible`, `Admissible` | `runUserMessage`, `admit`, `refusalOf`, `noteAsker` (sidecar/src/server/routing.ts); `claimConversation`, `ensureConversation`, `isVisibleTo`, `closureOf` (sidecar/src/state/conversations.ts) |
| `Begin`, `AutoFixBegin`, `TurnWrite` | `streamTurn`, `assertOpen` (sidecar/src/server/turns.ts); `appendToConversation` (conversations.ts) |
| `Delete` | `handleDeleteConversation`, `forgetConversation` (routing.ts); `deleteConversation` (conversations.ts) |
| `Restart` | `loadCacheFromDisk`, `snapshotState` (conversations.ts); `persistState`, `readStateFile` (sidecar/src/state/store.ts) |
