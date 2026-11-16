------------------------- MODULE ConversationDeletion -------------------------
(***************************************************************************)
(* One conversation id, two people, and everything that can touch it after *)
(* its owner deletes it: a turn admitted before the delete, a turn that    *)
(* runs through it, the auto-fix pass that follows a turn, a restart, and  *)
(* another person's first message under the same id.                       *)
(*                                                                         *)
(* Code: sidecar/src/state/conversations.ts (closure, ensureConversation,  *)
(* claim, delete, loadFromDisk, isVisibleTo), sidecar/src/state/store.ts   *)
(* (the `deleted` table in state.json), sidecar/src/server/routing.ts      *)
(* (admit, noteAsker, forgetConversation) and sidecar/src/server/turns.ts  *)
(* (streamTurn, assertOpen).                                               *)
(*                                                                         *)
(* Each boolean constant is one behaviour of the code, true where the code *)
(* has it today. The configs set them back to what the code did before     *)
(* #59 and before #60.                                                     *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    Actors,           \* the people who may act on the id
    MaxMessages,      \* bound: stored messages counted up to this
    DeleteClosesId,   \* #59: delete closes the id, so writes under it are dropped
    OwnerlessClosed,  \* #59: a record with no owner but messages is nobody's
    PersistDeleted,   \* #60: the closed ids are saved in state.json
    TurnChecksOpen,   \* #60: streamTurn calls assertOpen at its start and at each event
    DeleteStopsAutoFix \* #60: forgetConversation stops the conversation's auto-fix

VARIABLES
    exists,     \* cache.has(id): a stored record under the id
    owner,      \* its ownerId: an actor, or "none"
    msgs,       \* its messages, counted up to MaxMessages
    closed,     \* state.deleted.has(id): the id was deleted and is kept
    turn,       \* "idle" | "admitted" (past admit, before streamTurn) | "running"
    autoFix,    \* an auto-fix pass waits to start
    deleted,    \* history: the id was deleted at some point
    lateStart   \* history: a turn started running after the delete

vars == <<exists, owner, msgs, closed, turn, autoFix, deleted, lateStart>>

None == "none"

TypeOK ==
    /\ exists \in BOOLEAN
    /\ owner \in Actors \cup {None}
    /\ msgs \in 0..MaxMessages
    /\ closed \in BOOLEAN
    /\ turn \in {"idle", "admitted", "running"}
    /\ autoFix \in BOOLEAN
    /\ deleted \in BOOLEAN
    /\ lateStart \in BOOLEAN

Init ==
    /\ exists = FALSE
    /\ owner = None
    /\ msgs = 0
    /\ closed = FALSE
    /\ turn = "idle"
    /\ autoFix = FALSE
    /\ deleted = FALSE
    /\ lateStart = FALSE

\* closure(id) !== null for a deleted id: only once delete closes ids.
IsClosed == DeleteClosesId /\ closed

\* isVisibleTo(conversation, viewer) for a named viewer.
Visible(a) ==
    /\ exists
    /\ IF owner # None
       THEN owner = a
       ELSE msgs = 0 \/ ~OwnerlessClosed

\* refusalOf: closed, or a stored conversation the viewer may not see.
Admissible(a) == ~IsClosed /\ (~exists \/ Visible(a))

\* ensureConversation then claimConversation, which noteAsker runs.
Claim(a) ==
    IF exists
    THEN /\ owner' = IF owner = None /\ msgs = 0 THEN a ELSE owner
         /\ UNCHANGED <<exists, msgs>>
    ELSE /\ exists' = TRUE
         /\ owner' = a
         /\ msgs' = 0

\* admit, noteAsker: the request reaches the turn pipeline.
Admit(a) ==
    /\ turn = "idle"
    /\ Admissible(a)
    /\ Claim(a)
    /\ turn' = "admitted"
    /\ UNCHANGED <<closed, autoFix, deleted, lateStart>>

\* streamTurn: assertOpen, then runner.start.
Begin ==
    /\ turn = "admitted"
    /\ IF TurnChecksOpen /\ IsClosed
       THEN /\ turn' = "idle"
            /\ UNCHANGED lateStart
       ELSE /\ turn' = "running"
            /\ lateStart' = (lateStart \/ deleted)
    /\ UNCHANGED <<exists, owner, msgs, closed, autoFix, deleted>>

\* An auto-fix pass starts a turn with no admit.
AutoFixBegin ==
    /\ autoFix
    /\ turn = "idle"
    /\ autoFix' = FALSE
    /\ IF TurnChecksOpen /\ IsClosed
       THEN UNCHANGED <<turn, lateStart>>
       ELSE /\ turn' = "running"
            /\ lateStart' = (lateStart \/ deleted)
    /\ UNCHANGED <<exists, owner, msgs, closed, deleted>>

\* A turn event writes: appendToConversation through ensureConversation.
TurnWrite ==
    /\ turn = "running"
    /\ IF TurnChecksOpen /\ IsClosed
       THEN /\ turn' = "idle"
            /\ UNCHANGED <<exists, owner, msgs>>
       ELSE /\ turn' = turn
            /\ IF exists
               THEN /\ msgs' = IF msgs < MaxMessages THEN msgs + 1 ELSE msgs
                    /\ UNCHANGED <<exists, owner>>
               ELSE IF IsClosed
                    THEN UNCHANGED <<exists, owner, msgs>>
                    ELSE /\ exists' = TRUE
                         /\ owner' = None
                         /\ msgs' = 1
    /\ UNCHANGED <<closed, autoFix, deleted, lateStart>>

TurnEnd ==
    /\ turn = "running"
    /\ turn' = "idle"
    /\ \/ autoFix' = autoFix
       \/ autoFix' = TRUE
    /\ UNCHANGED <<exists, owner, msgs, closed, deleted, lateStart>>

\* handleDeleteConversation: admit, then forgetConversation.
Delete(a) ==
    /\ Admissible(a)
    /\ exists
    /\ exists' = FALSE
    /\ owner' = None
    /\ msgs' = 0
    /\ closed' = TRUE
    /\ deleted' = TRUE
    /\ autoFix' = IF DeleteStopsAutoFix THEN FALSE ELSE autoFix
    /\ UNCHANGED <<turn, lateStart>>

\* The sidecar restarts: state.json keeps the records, and the deleted ids
\* only when it saves them. A turn in flight is gone.
Restart ==
    /\ closed' = IF PersistDeleted THEN closed ELSE FALSE
    /\ turn' = "idle"
    /\ autoFix' = FALSE
    /\ UNCHANGED <<exists, owner, msgs, deleted, lateStart>>

Next ==
    \/ \E a \in Actors : Admit(a)
    \/ Begin
    \/ AutoFixBegin
    \/ TurnWrite
    \/ TurnEnd
    \/ \E a \in Actors : Delete(a)
    \/ Restart

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* The rules.                                                              *)
(***************************************************************************)

\* Once deleted, no write, claim or list entry brings the id back: it holds
\* no record, so it is in nobody's list and nobody owns it.
DeletedStaysDeleted == deleted => ~exists

\* Once deleted, no turn, an auto-fix pass included, starts under the id.
NoTurnStartsAfterDelete == ~lateStart

=============================================================================
