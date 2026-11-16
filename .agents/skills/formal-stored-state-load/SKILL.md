---
name: formal-stored-state-load
description: Property-based check (fast-check) that loading state.json or change-sets.json and then writing them keeps every valid entry unchanged and sets aside only the malformed ones. Use when a change touches the stored schemas, the conversation store, the change set store or the state file's reader and writer, or adds a field to a stored record.
---

# Formal check: stored state load keeps valid entries

The sidecar reads `state.json` (conversations) and `change-sets.json` (change sets) when it starts, and writes them back on the next change. A single conversation without `messages` once made the loader throw and fall back to the empty state, and the next write deleted every conversation (dms-ai#200, issue dms-ai#111). `change-sets.json` was read the same unchecked way. Tests checked a few fixed shapes. This check generates files of valid entries mixed with arbitrarily malformed ones, in any number and order.

The tool is fast-check on the real stores, not a hand model: the property is about what the code does with bytes on disk for every input, so a model of the loader would only check the model. TLA+ would suit an ordering question, and there is none here. The check is bounded by its generators and run count, not exhaustive, and fast-check prints the seed and a shrunk counterexample on failure.

## Run it

```sh
node .agents/skills/formal-stored-state-load/check.mjs
```

It prints nothing when it passes, and exits 1 when a property fails or 2 when Vitest cannot run. `pnpm test` runs it through `tests/formal-stored-state-load.test.cjs`, so `pnpm run checks` covers it. The sidecar's own Vitest job runs the same file (`sidecar/tests/formal/stored-state-load.test.ts`). A run takes about a second.

## The properties

For `state.json` through `createStore` and `createConversationStore`, then a write (`appendMessage` on a new id) and `flush`:

1. Every valid conversation is loaded unchanged, and written back unchanged, extra keys included.
2. The loaded conversations are the valid ones and the new one, nothing else.
3. Every malformed entry is set aside (`closure` is `set_aside`) and written back byte for byte as it was.

For `change-sets.json` through `createChangeSetStore`, then `add` and `flush`:

1. `all()` holds the valid change sets, unchanged and in order, then the new one: no malformed entry.
2. The written file holds every entry, valid or not, unchanged, and the new one.

## The generators

`sidecar/tests/formal/stored-state-load.test.ts` builds a valid conversation and a valid change set from the field lists of `stored-schemas.ts`, with optional fields and unknown extra keys. A malformed entry is a valid one with one required key removed or set to `null` or an object, a conversation whose message has a field set to `null`, or a value that is not an object at all. Every generated value is read back from its JSON text before it goes into the file, because JSON has no `-0` and a file never holds one. By construction none of the malformed ones can pass the schema, and the check does not use the schema to decide which is which. The explicit example in `examples` is the shape of #200: a valid conversation next to one with no `messages`.

## Before the fix

The check fails on the code before #200 (`5a814cc^`): copy the test file into a worktree of that commit, add `fast-check`, run `pnpm --dir sidecar exec vitest run tests/formal/stored-state-load.test.ts`. The conversation property fails on the example: `expected undefined to deeply equal { messages: [...], ... }`, the valid conversation is gone. The change set property fails with a malformed entry in `all()`.

## What it covers

Not covered: a file that is not an object, or whose `conversations` or `changeSets` is not (both fall back to the empty state, by design), the `deleted` table, the debounce timing of the write, a file edited while the sidecar runs, and entries whose fields are valid but unknown to this version's enums (the schema sets those aside, as it does a malformed one, and the generators do not produce them).

## Real bug or modeling error

Run the failing example by hand with `createConversationStore` or `createChangeSetStore` over a scratch file. When the stores lose or alter a valid entry, it is a bug. When a generated entry is not what it claims, fix the generator: add a scratch assertion that the schema accepts every valid sample and rejects every malformed one.

## Changing the check

- A new required field in a stored record: add it to the valid generator and to the list of required keys. A new optional field needs only the generator.
- Do not weaken a property to make it pass; set the entry aside in the code instead.
- Sync commit: `ad5c6f8`. To see whether the check needs another look:

```sh
git diff --stat ad5c6f8 -- sidecar/src/state/store.ts sidecar/src/state/change-sets.ts sidecar/src/state/stored-schemas.ts sidecar/src/state/conversations.ts sidecar/src/state/types.ts
```

Move the sync commit forward only after you confirm the generators describe the schemas at the new commit.

| Property | Code |
| --- | --- |
| conversations load and write | `parseStateContents`, `readConversations`, `persistState` (sidecar/src/state/store.ts); `loadCacheFromDisk` (sidecar/src/state/conversations.ts); `StoredConversationSchema` (sidecar/src/state/stored-schemas.ts) |
| change sets load and write | `parseContents`, `persist` (sidecar/src/state/change-sets.ts); `ChangeSetRecordSchema` |
