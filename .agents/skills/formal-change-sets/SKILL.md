---
name: formal-change-sets
description: TLA+ model of the sidecar's change sets (the before and after snapshots a turn takes, the owner's Undo, Undo with the later sets, and Redo, all through the one checkpoint lock), checked with TLC. Use when a change touches a file in its coverage record, or when a change to checkpoints, Undo, Redo or how turns record their files needs proof that it breaks no rule of the owner's lines.
---

# Formal check: change sets, Undo and Redo

Undo and Redo are the only part of the assistant that rewrites the owner's project files on request, and a wrong order of steps loses lines the owner kept or brings back lines the owner removed. Tests check the orders someone wrote down. This check lets TLC try every order of turns, edits, Undo and Redo within the bounds below.

`ChangeSets.tla` models a file as the set of change sets whose lines it holds. An agent's edit adds its turn's lines. A restore puts a file back whole, as a snapshot holds it, which is what `git checkout <tree> -- <file>` does. Each step the model takes in one go is one step in the code: the lock (`serialize`) runs one task at a time, in order. Undo and Redo check the set's state and choose their targets on the lock, so a request that waits behind another sees what that one changed.

## Run it

```sh
node .agents/skills/formal-change-sets/check.mjs
```

It needs Node 24 and Java 11 or later from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (set `TLC_DOCKER_PREFIX` to name the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. A run takes about 30 s and explores about 240,000 states for `Sequential.cfg` and 186,000 for `ChangeSets.cfg`.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script keeps TLC's output in a temporary folder and prints its path.
- Exit 2 means TLC or Java could not run.

`check.mjs` follows the output contract of the shared runner in `@antelopejs/tooling-configs/formal`. The repository pins a pack release without it; when the pack moves to 0.2.18 or later, `check.mjs` can call `checkSpec` twice instead.

## When to run it

Run it when a change touches any file in the coverage record below. A changed rule (exit 1) fails the change, and the recorded findings fail it only when the diff changes what the covered code does.

## The configs

| Config | Bounds | What it allows |
| --- | --- | --- |
| `Sequential.cfg` | 3 turns, 2 files, 2 tasks queued | One turn at a time, and the owner clicks only when nothing waits on the lock. Only the logic of Undo and Redo is left. |
| `ChangeSets.cfg` | 2 turns, 2 files, 2 tasks queued | What the code allows: two chats run turns at once, and Undo or Redo may land while a turn runs or while other tasks wait. |

A pass covers these bounds, not every project. Edits only add lines; the model has no edit that removes another set's line, no failed snapshot, no retention prune, and no Builder operation. The model has one person, who may use every conversation, as on the Changes page (`POST /ai/changes/:id/undo`). An undo over the chat socket takes only the later sets of conversations its sender may use; `formal-chat-ownership` checks that.

## The rules

| Rule | Plain sentence | Sequential | ChangeSets |
| --- | --- | --- | --- |
| `TypeOK` | Every variable keeps its type. | holds | holds |
| `ConcurrentTurnsAreFlagged` | Two turns that ran at once are both flagged overlapped. | not checked | holds |
| `SetHoldsOnlyItsTurnsLines` | A change set not flagged overlapped lists only files its own turn edited. | holds | finding F4 |
| `UndoReachesLaterSets` | An Undo with the later sets leaves no later Applied set on its files. | holds | holds (F5 fixed) |
| `UndoAloneKeepsLaterLines` | Undoing a set alone keeps the later sets' lines, as the Changes docs say. | finding F1 | not checked |
| `RedoKeepsAppliedLines` | A Redo never removes lines of a set that is Applied. | finding F2 | not checked |
| `RedoLeavesUndoneLinesOut` | A Redo never puts back lines of another set that is Undone. | finding F2 | not checked |
| `UndoLeavesUndoneLinesOut` | An Undo never puts back lines of a set that is Undone. | finding F3 | not checked |
| `UndoKeepsAppliedLines` | An Undo with the later sets never removes lines of a set it leaves Applied. | finding F3 | not checked |

`check.mjs` records each finding's counterexample length in `CHECKS`. The harm, for every lines rule: the Changes page says Applied or Undone, and the files say otherwise, so the owner ships lines they undid or loses lines they kept.

## Findings at the sync commit

Each finding was replayed against the real code at the sync commit, with `createCheckpoints`, `createShadowGit` and `createChangeSetStore` from the built sidecar over a scratch project. The replays were scratch scripts and are not committed. In each, set A appends the line `A` to `f.txt` and set B the line `B`.

- **F1, Undo alone drops later lines (`UndoAloneKeepsLaterLines`, 13 states).** A, then B, both on `f.txt`. The owner unticks **Also undo the later change sets** and undoes A. `restore` checks out `f.txt` as A's before snapshot holds it, so B's line goes too, and B still reads Applied. Replay: `f.txt` is `base`, states A undone, B applied. The docs (`docs/4.usage/3.changes.md`, step 3) say this keeps the later sets' lines.
- **F2, Redo puts back whole files (`RedoKeepsAppliedLines`, `RedoLeavesUndoneLinesOut`, 15 states each).** A is undone, then B edits `f.txt`; redoing A checks out A's after snapshot, which has no `B`, so B's line goes while B reads Applied. Or A and B are undone together and the owner redoes B first; B's after snapshot holds `A`, so A's line returns while A reads Undone. Replay of the second: `f.txt` is `base A B`, states A undone, B applied.
- **F3, Undo restores a snapshot that holds other sets' lines (`UndoLeavesUndoneLinesOut` 15, `UndoKeepsAppliedLines` 17 states).** A then B on `f.txt`; A is undone alone, then B is undone; B's before snapshot holds `A`, so A's line returns while both read Undone. In the 17-state path, a Redo of A after B rewrote the file makes the later Undo of B remove A's line while A reads Applied.
- **F4, an Undo during a turn is recorded as that turn's change (`SetHoldsOnlyItsTurnsLines`, 12 states).** A is recorded; turn T starts and takes its before snapshot; the owner undoes A; T ends. T's after snapshot differs from its before snapshot on `f.txt`, so T's change set lists `f.txt` although T's agent never wrote it, and `markOverlaps` only flags turns, so T is not flagged. Undoing T then restores `A`. Replay: T's files `["f.txt"]`, overlapped false; after undoing T, `f.txt` is `base A` with A and T both undone. Neither the HTTP route nor the chat socket refuses an Undo while a turn runs.
- **F5, fixed: an Undo misses a set recorded while it waits (`UndoReachesLaterSets`, was 12 states).** `undo()` and `redo()` ran `requireState` and `laterConflicts` when asked, before the lock. A turn that finished just before, whose after snapshot still waited on the lock, was recorded after the targets were chosen, so the Undo restored the shared file and left that set Applied without its lines. The same early check let "undo A with the later sets" followed at once by "undo B" restore B twice, which left `f.txt` holding A's line with A and B both Undone. Both now run on the lock, and a request for a set no longer in the state it expects is refused with `Change set #<n> is already <state>.`. The case `answers that a later set is already undone when its undo arrives right after an undo that took it along` in `sidecar/tests/unit/checkpoints.test.ts` replays the second order and failed before the fix.

F1 to F3 need no concurrency: every Undo and Redo replaces whole files, so any two change sets on one file can lose or resurrect each other's lines. F4 needs a turn running while the owner clicks.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of `ChangeSets.tla` and the two configs in a scratch folder outside the repo, since it writes its output next to its input. The spec is `ChangeSets.tla`. Chart `Sequential.cfg` for Undo and Redo alone, and `ChangeSets.cfg` for turns that overlap. Pass today's findings as the rules expected to break. A new bug shows as a new numbered path, and a fix shows which bug paths it removes.

## Real bug or modeling error

Replay the counterexample against the code, one action per step, with the coverage record below. `RequestUndo` and `RequestRedo` are a click on Undo or Redo (`POST /ai/changes/:id/undo` and `/redo`); `BeginTurn` and `Finish` are a chat turn's start and end; `RunLock` is the next task on the lock. A step order is a modeling error when the code cannot produce it, most likely because two model steps are one synchronous run in the code. Then fix the model, keep the rule, and say why. Otherwise reproduce it with `createCheckpoints` over a scratch project, or through the Changes page with a journey of `e2e/journeys/changes.mjs`, and assert only what the owner sees: the file's text and the set's state.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep its comment naming the code, then rerun.
- Never weaken or drop a rule to make the check pass. A fixed finding moves out of `CHECKS` once a replay confirms the fix. A new finding goes into `CHECKS` with its counterexample length, and into this file with its replay.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

Sync commit: `935867f`. The covered files last changed in `5bd4c09`. To see whether the model needs another look:

```sh
git diff --stat 935867f -- sidecar/src/checkpoints sidecar/src/server/change-set-actions.ts sidecar/src/server/turns.ts
```

| Model action | Code |
| --- | --- |
| `BeginTurn` | `beginTurn`, `markOverlaps` (sidecar/src/checkpoints/checkpoints.ts:193-225), called from `beginTurn` in sidecar/src/server/turns.ts:281 |
| `Edit` | a mutating tool after `TurnCheckpoint.ready()` |
| `Finish`, `TakeAfter` | `finish`, `recordTurn`, `buildRecord` (checkpoints.ts:150-191, 212), `changedFiles` (sidecar/src/checkpoints/shadow-git.ts:157) |
| `TakeBefore` | the `before` snapshot in `beginTurn`, `snapshot` (shadow-git.ts:123) |
| `RunLock`, `queue` | `serialize` (checkpoints.ts:126) |
| `RequestUndo` | `undo` up to `serialize` (checkpoints.ts:308-313), `handleChangeSetAction` (sidecar/src/server/change-set-actions.ts) |
| `RunUndo`, `Refuse`, `Later`, `Desc`, `Restore`, `UndoAll` | `undo`'s serialized task: `requireRecord`, `requireState`, `laterConflicts`, the restore loop (checkpoints.ts:313-328), `markState` (checkpoints.ts:282), `restore` (shadow-git.ts:221) |
| `RequestRedo`, `RunRedo`, `Refuse` | `redo` (checkpoints.ts:331-343) |
