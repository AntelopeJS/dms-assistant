---
name: formal-connection-analysis
description: Bounded check, over every order of two tabs' steps and answers, that a database connection's analysis starts once and its schemas question is answered once, and that a closed popup's late write never replaces a newer connect attempt. Use when a change touches the onboarding's Connect and analyse code (`connect-database.ts`, `analysis-lead.ts`, `connect-memory.ts`) or the builder runtime's build state, or when it adds a step a tab can take while a connection loads.
---

# Formal check: two tabs on one connection's analysis

The onboarding's "Connect and analyse" popup writes a database connection into the project, then polls until the connection's analysis is ready, starting it and answering its schemas question on the way. A browser tab duplicated while that loads copies `sessionStorage`, so two tabs follow the same connection. If both start the analysis or answer its schemas question, `@antelopejs/dms` replaces a finished job with a new one (#63). `onboarding-database-tabs.test.ts` pins the few orders someone wrote down; this check tries every order within its bounds.

The tool is Vitest on the real code, not a hand model: `useDatabaseConnect`, `analysisLead` and `connectMemory` run unchanged. A stand-in `@antelopejs/dms`, a stand-in Web Lock manager and stand-in timers never act on their own: the driver chooses each next step. The world is `frontend-vue/tests/formal/connection-analysis-world.ts`, the scenarios `connection-analysis-scenarios.ts`, the driver `connection-analysis.test.ts`.

## Run it

```sh
node .agents/skills/formal-connection-analysis/check.mjs
```

It prints nothing and exits 0 when every rule holds and every recorded defect still breaks. Exit 1 means a rule changed, 2 means the tests could not run. `pnpm test` runs it through `tests/formal-connection-analysis.test.cjs`, so `pnpm run checks` covers it, and frontend-vue's own Vitest job runs the same file. A run takes about 15 s and needs no Java. `FORMAL_DEPTH=<n>` changes how many choices are tried in every order (default 16); `FORMAL_VERBOSE=1` prints the paths tried and the first failing path of each scenario.

## The property

In every scenario, after every step:

1. At most one analysis job is started per connection. A start is a `POST /analyse` with no schemas.
2. The schemas question is answered only while it is open: an answer with no question open replaces a finished job.
3. A tab's `sessionStorage` entry names the connection of its latest attempt, or none after a `reset`. A write from a popup that closed, or from an attempt a later connect replaced, changes nothing.
4. While no answer is in flight, a tab holds a connection's Web Lock only while its popup is following that connection: a stopped follow or a closed popup leaves no lock held.

## The world

- Two tabs of one browser, each with its own `sessionStorage` and one program of steps: `open` a popup, `close` it, `closeTab`, `reset`, `connect <database>`. The driver tries every order of the steps and of the answers the tabs wait for. A `quiet` step waits until no answer is in flight anywhere.
- A request reaches the stand-in server at once and changes it; only its answer waits for a choice. An analysis read answers what the server held when it was sent, so two tabs can both read "no analysis".
- A Web Lock is decided when it is requested (`ifAvailable`), and only its callback waits. A closed tab releases its locks, loses its pending answers and timers, and leaves what it already sent.
- A poll timer fires only when no answer is in flight: every answer arrives within the one-second poll period.
- Two kinds of analysis: one asks which schemas to read, one finishes at once.
- Scenarios: two tabs that both remember `shop` (a duplicated tab) with the other tab staying, closing, resetting or connecting `orders`; one tab that connects, closes its popup, opens it again, and connects another database, resets or connects the same one twice.

## What it covers

Bounds: two tabs, two databases, programs of at most five steps, every order of the first 16 choices, then the oldest choice first until nothing is left or 80 steps ran. Not covered: three tabs, a popup opened in a tab with an unfinished attempt of another popup beyond the listed programs, a project reload (`reloadDue` always answers no, and every declared connection is listed at once), a failing request, the connection check refusing a database, the 15-minute memory limit, and the access choice. Safety only: the check never asks whether an analysis does start.

## Findings at the sync commit

- **F1, a tab acts on a view read before it took the lock.** `followBuild` reads the build, then asks for the lock, then starts the analysis from that read without reading again. When the leading tab sends its request and then closes its tab, resets or connects another database, the lock is free again. A follower whose read left before that request, and arrived after the lock was freed, still sees no analysis, takes the lock and sends a second start. Path (`duplicate, the first tab closes while an answer is in flight`): tab 0 opens, tab 1 opens, tab 0's read answers, tab 0's lock request is answered and tab 0 sends `POST /analyse`, tab 0 closes, tab 1's older read answers, tab 1's lock request is answered, tab 1 sends `POST /analyse`. The window is one request round trip after the leader's request, so it is narrow; it needs the leader to leave inside it. The three `while an answer is in flight` scenarios carry it as `defect`: they pass while the defect exists and fail the day it is fixed. Remove the `defect` field then.

## Before the fix (#63)

The check fails on the code before #63. Put `app/onboarding/connect-database.ts` from `a3dee0bbd^` in place and remove `analysis-lead.ts`:

| Code | Failing scenarios |
| --- | --- |
| before #63 (`a3dee0bbd^`) | `duplicate, both stay`, `duplicate, both stay, no question`, the three `once every answer arrived` scenarios that remember `shop` in both tabs, and `duplicate, the first tab connects another database once every answer arrived`: each with `2 analysis jobs started for shop, where one may` |

Two more breaks the check must catch, each by editing one line of the code: `connectMemory.write` that ignores its attempt fails the three scenarios of one tab that close its popup or reset; an `analysisLead` that keeps a lock granted after its follow stopped fails the three single-tab scenarios on rule 4.

## Real bug or modeling error

Read the first failing path the assertion prints: each line is a tab and the step or answer it took. Replay it in the browser by hand: two tabs on the onboarding popup, the project declared, the network slowed to put the order right. A path is a modeling error when the browser cannot produce it, most likely because two model steps are one synchronous run in the code, or because an answer would need longer than the poll period. Then fix the world, keep the rule, and say why here. Never weaken a rule to make the check pass.

## Changing the check

- A new step a tab can take: add it to `Step` and `perform` in the world, then to a program in `connection-analysis-scenarios.ts`.
- A new thing a tab can observe or keep: add it to `violations` in the world.
- A fixed defect: delete its `defect` field and its line above.
- Sync commit: `852e655`. The covered files:

```sh
git diff --stat 852e655 -- frontend-vue/app/onboarding/connect-database.ts frontend-vue/app/onboarding/analysis-lead.ts frontend-vue/app/onboarding/connect-memory.ts frontend-vue/builder/app/runtime/database-build.ts
```

Move the sync commit forward only after you confirm the check describes the code at the new commit.

| Case | Code |
| --- | --- |
| a popup's follow, its polls and its generations | `useDatabaseConnect`, `poll`, `keepsFollowing`, `followBuild`, `stop` (`connect-database.ts`) |
| the lead | `analysisLead`, `tabAnalysisLead` (`analysis-lead.ts`) |
| attempts and the remembered connection | `connectMemory` (`connect-memory.ts`) |
| what the server answers | `readBuild`, `buildState` (`database-build.ts`) |
