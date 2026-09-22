# Background-task roster store

The renderer's held copy of each open conversation's live background-task set — a dedicated,
unidirectional Zustand store fed by a headless subscription binding that observes all **three** typed
daemon events in the family — the [daemon-event channel](daemon-event-channel.md)'s `backgroundTaskRoster`
aggregate, `backgroundTaskStarted` scalar and `backgroundTaskUpdated` scalar arms — joining them per task
so the still-unbuilt panel slice (#568) will read one source of truth once it lands.

Introduced in [#573](../codebase/573.md), split from #567 alongside #574 (the two scalar arms,
`backgroundTaskStarted`/`backgroundTaskUpdated`). #574 was itself later split into
[#576](../codebase/576.md) (joined `backgroundTaskStarted`, reshaping the held value to be per-task) and
[#577](../codebase/577.md) (this doc's current shape — joins the last arm, `backgroundTaskUpdated`/
`patch`). None of #573/#576/#577 shipped a visible surface — the store is populated and unread,
deliberately, the same posture #564/#565/#566 already shipped for the underlying wire arms. #568 (panel)
is still open and remains the first reader.

## What it does

Holds each conversation's currently-believed-live background-task set, keyed by `conversationId`, with
each task keyed within it by `taskId` — the **join** of what the two frames each report, rather than
either source held verbatim:

- A `backgroundTaskRoster` frame is **replacement truth for membership**: a task present in an earlier
  roster and absent from a later one is no longer held, whether it was first learned from a roster row
  or from a `backgroundTaskStarted` frame. There is no terminal/finish event by design — absence from a
  later roster is this family's only removal path. An empty roster (`tasks: []`) still writes an entry —
  the daemon's positive statement "nothing is alive for this conversation" — never dropped, filtered, or
  coalesced as "no news".
- A `backgroundTaskStarted` frame **upserts one task**, carrying a `toolCallId` and a fuller,
  higher-cap `description` that no roster row can report. Once a task is started-sourced, a later roster
  naming the same `taskId` leaves its held record untouched rather than overwriting it — the daemon's own
  roster-cap comment states the roster label is the same text under a tighter cap and that the
  authoritative full copy already crossed the wire on the started frame, so refreshing from the row would
  throw the better copy away permanently (the started frame never repeats). A task the app only ever
  learns about from a roster has `toolCallId: null` — never a placeholder, since `''` is a real,
  colliding `tool_call_id` value the wire can send.
- A `backgroundTaskUpdated` frame **records the latest patch onto an already-held task** — never opens
  one. `patch` (opaque text, held verbatim) and its own cut report are latest-wins, one nested record
  ([#577](../codebase/577.md)): `null` means no update has ever matched the task, `{ patch: '', … }` is a
  recorded value meaning "claude sent no change", and the two never substitute for each other. An update
  naming an unknown conversation or an unknown `taskId` is silently ignored. Unlike the started frame's
  fields, a patch **survives** a roster replacement of its task regardless of provenance — no roster row
  can report a patch, so a later roster's row still refreshes the task's label/type/own cut report while
  leaving the recorded patch alone.

Deliberately **not** a [session store](session-store.md) or [timeline store](conversation-timeline-store.md)
facet: like `queue_state`, this family is daemon *state* (SSOT pyrycode #720), not part of claude's turn
stream, so it gets its own store rather than folding into `reduceTimeline`.

On the `connected` daemon edge, the store drops the **reconnecting server's own** held rosters, started-
sourced and roster-sourced tasks alike — and, since #569, the daemon's own reconcile repopulates them
safely rather than leaving the drop as the last word. Upstream (pyrycode#2077-#2080),
`background_task_roster` joined the daemon's reconcile-on-connect set (beside outstanding `modal_shown`
per pyrycode#877 and `queue_state` per non-empty backlog per pyrycode#878): on any (re)connection the
daemon unicasts one roster per conversation whose bound session has reported one, snapshot-shaped and
correlated by `conversation_id`, so `setRoster`'s unconditional replacement applies it idempotently and
the burst's order — the daemon walks its registry in insertion order, not a contract — is immaterial.
**Two silences, and they stay apart.** A session that reported an *explicit empty* roster reconciles to
`tasks: []` and reads "observed, nothing alive" ("No background tasks"). A session that has *never*
reported one is simply *absent* from the burst, stays dropped, and reads `null` — "nothing has been
reported", never "nothing is alive" ("No background-task report yet"). The `backgroundTaskStarted`/
`backgroundTaskUpdated` scalars are **not** in the reconcile set, so a task the app had upgraded to
started-sourced comes back roster-sourced after a reconnect, without its `toolCallId` or fuller label — a
real narrowing, pinned by a store test rather than merely stated. What makes the drop safe rather than
destructive is that the clear and the reconciled burst ride one listener in arrival order — proved
end-to-end through the real transport, not merely argued from the two call sites' code, by
`e2e/background-task-reconnect.spec.ts`.

Since [#1117](daemon-connection-routing.md) the app holds one live connection per paired server, so
`connected` means "*this* server's connection came back", not the app's one connection coming back — the
edge was originally a nullary whole-map clear, which
[#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) scoped to the reconnecting server's own
conversations (sourced from the [server-keyed conversation
list](conversation-list-store.md#one-slot-per-server-since-1086)), the same fix
[#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) shipped for [`queueStore`](queue-store.md)
one week earlier. Scoping the edge retired the self-heal that had kept this store out of
[`clearPairingScopedState`](paired-shell.md#related): a new pairing's first `connected` resolves an empty
conversation list, matches no held roster, and would otherwise drop nothing at all. So the store also
joined that set — a second, nullary setter drops **every** conversation's held roster wholesale at a
pairing boundary (unpairing, or pairing another server), closing the gap the scoped edge opened. This
family had no re-assertion path of any kind, so unlike `queueStore`'s drained-conversation case, every
roster latched for the life of the process until this clear was added. Since #569 the daemon's reconcile
re-asserts a roster, but only for the conversations of the *pairing that reported them* — a new pairing's
first `connected` still resolves an empty conversation list and drops nothing — so the clear remains
required for the unchanged reason: a departed pairing's `local_bash` command lines and `patch` text would
otherwise still be attributed, indefinitely, to a machine the operator has left.

## How it works

### The store (`src/renderer/src/store/backgroundTaskRosterStore.ts`)

```ts
export interface HeldBackgroundTaskUpdate {                    // the latest patch + its OWN cut report (#577)
  patch: string                                                 // opaque text, held verbatim, never parsed
  truncatedFields: readonly string[] | null
}
export interface HeldBackgroundTask {                          // per-task, renderer-side camelCase (#576)
  taskId: string
  toolCallId: string | null       // null = roster-sourced; only a started frame ever reports one
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
  latestUpdate: HeldBackgroundTaskUpdate | null   // null = no update has ever matched this task (#577)
}
export interface BackgroundTaskRosterEntry {
  tasks: ReadonlyMap<string, HeldBackgroundTask>   // keyed by taskId, built at WRITE time; insertion order = roster order
  droppedTasks: number                             // roster's ONLY truncation report; true size = tasks.size + droppedTasks
}
export interface BackgroundTaskRosterSnapshot {                // roster write unit — wire rows, unchanged shape
  conversationId: string
  tasks: readonly BackgroundTask[]
  droppedTasks: number
}
export interface BackgroundTaskStartedSnapshot {               // started write unit (#576) — toolCallId non-nullable, the frame always reports one
  conversationId: string
  taskId: string
  toolCallId: string
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
}
export interface BackgroundTaskUpdatedSnapshot {               // update write unit (#577) — FOUR fields, no toolCallId/description/taskType
  conversationId: string
  taskId: string
  patch: string
  truncatedFields: readonly string[] | null
}
export interface BackgroundTaskRosterState {
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>   // key absent = no frame has ever arrived
}
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void   // #576
  setUpdatedTask: (snapshot: BackgroundTaskUpdatedSnapshot) => void   // #577
  resetRostersFor: (conversationIds: ReadonlySet<string>) => void   // connected edge, scoped (#1139)
  clearAllRosters: () => void                                       // pairing-boundary drop, nullary (#1139)
}

createBackgroundTaskRosterStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
backgroundTaskRosterStore                  // app-wide singleton
useBackgroundTaskRosterStore(selector)     // narrow-slice React binding: useStore(store, selector)
selectRosterFor(conversationId)(state)     // selector FACTORY — the primary read surface (#568), returns `?? null`
```

Keyed by `conversationId`, not a flat slot, for the same reason [`queueStore`](queue-store.md) is: the
daemon fans these frames out to every interactive connection and each carries `conversation_id`, so
frames for *different* conversations can arrive back-to-back and a flat "hold the latest" slot would let
one clobber another. **Five named setters** (`setRoster`, `setStartedTask`, `setUpdatedTask`,
`resetRostersFor`, `clearAllRosters`), not a reducer — five operations still don't justify a
discriminated-union action set. Mirrors `queueStore`'s DI-factory → singleton → hook → selector structure
and its `ReadonlyMap` copy-on-write idiom throughout: clone the outer map, clone the inner map, replace;
never mutate `s.rosters`, an entry, or an entry's `tasks` in place. Also mirrors `queueStore`'s setter
PAIR for the pairing-lifecycle problem ([#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) /
[#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)): a scoped `…For` reset beside a
nullary whole-map clear, both iterating the HELD keys rather than the input set, so the work is bounded
by what this store holds rather than by a server's conversation count.

`setRoster` (#576 reshape, #577 carry-over fix) rebuilds the conversation's task map from the snapshot's
rows **in row order**: for each row, if a task is already held under that `task_id` **and is
started-sourced** (`toolCallId !== null`), the held record is kept unchanged — the started frame's label
is authoritative and never repeats, so refreshing from the row would throw away the fuller copy
permanently (AC2). Otherwise a fresh `HeldBackgroundTask` is built from the row with `toolCallId: null`,
and that fresh literal carries `latestUpdate: held?.latestUpdate ?? null` — a recorded patch rides across
the rebuild **individually**, deliberately *not* folded into the `toolCallId !== null` provenance
predicate that gates keeping the whole record. Folding it in would freeze a patched roster-sourced task's
label/type/own cut report at whatever they were when the patch arrived, since the rebuild branch would
then never run again for that task; leaving it out of the fresh literal entirely would drop the patch at
the very next roster. Both mistakes compile clean and break no other test — see [#577's codebase
notes](../codebase/577.md) § "The trap" for the full reasoning and the one test that discriminates all
three ways this branch can go wrong. `droppedTasks` is taken from the snapshot unconditionally. The write
stays **unconditional**: an empty `tasks: []` still writes an entry holding no tasks ("nothing is alive"),
it does not delete the key.

`setStartedTask` (#576, new; #577 gained the same carry-over) upserts one task into its conversation's
entry, **creating** the entry if no frame has arrived for that conversation yet — claude orders these
frames, not the daemon, so a started frame can precede any roster for its conversation, *and* can arrive
after an update for the task it is about to open. `Map.set` keeps an existing key's position, so
upgrading a roster-held task in place preserves roster display order while a genuinely new task appends.
The snapshot's `description`/`taskType`/`truncatedFields` **replace** whatever the task held; the three
frames' `truncatedFields` lists name different vocabularies, so a started frame's list replaces rather
than unions with a roster row's. `droppedTasks` is **preserved** from the existing entry (or `0` on
create) — a started frame reports nothing about roster truncation and must not reset the count. A held
`latestUpdate` is likewise **preserved** — a started frame reports no patch, so it must not silently erase
one recorded before it arrived.

`setUpdatedTask` (#577, new) records **one task's latest patch and its own cut report**, joined on
`conversationId` + `taskId` and never on arrival order — an update can arrive before the roster or started
frame that first names its task. It is the only setter that can **miss**: an update naming an unknown
conversation, or a `taskId` the conversation does not (yet) hold, returns the state object **itself**
unchanged — `Object.is`-provable, so "creates no partial entry" (AC2) needs no enumeration of what didn't
appear. An update never opens a task and never creates a conversation entry, because a patch is a change
report about something already alive, not an announcement. On a hit, `latestUpdate` is replaced wholesale
(latest-wins — never an accumulating list) and nothing else on the held record is touched: an update frame
reports no `description`, `taskType`, `toolCallId`, or task-level `truncatedFields`. Both miss branches are
silent, deliberately — a "dropped an unmatched update" log line is exactly where patch text could leak
into a file (the content-free diagnostics rule, #126).

Provenance — "was this task's fuller label ever reported?" — is **derived, never stored**: exactly
`toolCallId !== null`. This must be tested with `!== null`, never truthiness: `requireString` (the
main-side decode helper) admits `''` as a valid `tool_call_id`, so a truthiness check would silently
demote a task whose id happens to be `''` back to roster-sourced and let the next roster overwrite its
fuller label. `latestUpdate`'s presence is *not* a second provenance signal — a roster-sourced task can be
patched too, and still refreshes from later roster rows exactly as an unpatched one would.

**The one place the `queueStore` precedent is deliberately *not* cloned.** `queueStore.selectBacklogFor`
returns `s.backlogs.get(id) ?? EMPTY_BACKLOG`, collapsing "never observed" and "observed, empty" into the
same bare `[]` — correct for `queue_state`, but this store needs the two distinguishable (AC5, ex-AC4).
The fix is `selectRosterFor`'s `?? null` instead of `?? EMPTY_BACKLOG`, typed
`BackgroundTaskRosterEntry | null`:

| store contents for `c1` | `selectRosterFor('c1')` | meaning |
| --- | --- | --- |
| key absent | `null` | no frame has ever arrived for this conversation |
| `{ tasks: Map{}, droppedTasks: 0 }` | that entry | observed, nothing alive |
| `{ tasks: Map{t}, droppedTasks: 2 }` | that entry | 1 task carried, 3 truly alive |

`null` is a stable reference by construction, so — unlike `queueStore`'s hoisted `EMPTY_BACKLOG` — this
store needs **no `EMPTY_*` constant at all**: one fewer export, one fewer thing to get wrong. The
nullable return type also forces #568 to branch, so the distinction can't be ignored accidentally. There
is deliberately no whole-map analogue of `queueStore`'s `selectBacklogs`: the reset here clears the map
wholesale and nothing else reads the map, so shipping an unread read surface would repeat the exact
dead-export `queueStore` already carries (see [queue store § Edge cases](queue-store.md)).

`resetRostersFor(conversationIds)` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139),
the `connected`-edge reset) iterates the **held** map's own keys, not the id set, and deletes the ones
that are members — work bounded by what this store holds, not by the server's conversation count.
Membership is tested with `Set.has`, never a bare object lookup, which is also what keeps `__proto__`,
`constructor` and `''` unremarkable conversation keys. Deleting the map key drops a conversation **whole**
— a started frame's `toolCallId` and an update frame's `latestUpdate` go with the roster row they joined,
so the reset can never half-drop an entry. Every surviving entry comes back **by reference**. When no held
key is listed — a first connect, a reconnect of a server holding nothing here, or a map holding only
conversations outside the id set — the state object is handed straight back, generalising the original
`resetRosters`' `size === 0` short-circuit so zustand's `Object.is` fires and no listener wakes. A
conversation this store holds a roster for that appears in **no** server's list survives every scoped
reset — the accepted consequence of scoping by the list (a background task can start for a conversation
whose list has not arrived), pinned by a test rather than left to drift wider later.

`clearAllRosters` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139), the
**pairing-boundary** drop) is nullary — the `clearAllBacklogs`/`clearAllConversations` shape — so no
daemon-supplied conversation id or server origin can steer which command lines and patches survive a
boundary the operator crossed deliberately. It returns `initialBackgroundTaskRosterState` by reference and
carries the same `size === 0` subscriber short-circuit. It is invoked only from
[`clearPairingScopedState`](paired-shell.md#related), never from a bridge arm or a component, and it is
the only setter that reaches a roster held under a conversation no server's list ever carried.

### The data path (`src/renderer/src/store/backgroundTaskRosterBridge.ts`)

```ts
translateBackgroundTaskRoster(event: DaemonEvent): BackgroundTaskRosterSnapshot | null
// switch (event.type) { case 'backgroundTaskRoster': return { conversationId, tasks, droppedTasks }; default: return null }

translateBackgroundTaskStarted(event: DaemonEvent): BackgroundTaskStartedSnapshot | null   // #576, sibling translator
// switch (event.type) { case 'backgroundTaskStarted': return { conversationId, taskId, toolCallId, taskType, description, truncatedFields }; default: return null }

translateBackgroundTaskUpdated(event: DaemonEvent): BackgroundTaskUpdatedSnapshot | null   // #577, third sibling translator
// switch (event.type) { case 'backgroundTaskUpdated': return { conversationId, taskId, patch, truncatedFields }; default: return null }

originOf(event: DaemonEvent): ConversationListOrigin   // since #1139 — reads #1068's stamp, never event.ack

subscribeBackgroundTaskRoster(onDaemonEvent, setRoster, resetRostersForServer, setStartedTask, setUpdatedTask): () => void   // fifth param, #577; third param re-typed by #1139
// onDaemonEvent(event => {
//   if (event.type === 'connected') { resetRostersForServer(originOf(event)); return }
//   const roster = translateBackgroundTaskRoster(event); if (roster !== null) { setRoster(roster); return }
//   const started = translateBackgroundTaskStarted(event); if (started !== null) { setStartedTask(started); return }
//   const updated = translateBackgroundTaskUpdated(event); if (updated !== null) setUpdatedTask(updated)
// })

BackgroundTaskRosterData(): null
// headless component, one subscribe effect (deps []), mounted app-level in App.tsx as the SEVENTH leaf
// the composition root (#1139): resolves origin -> conversation ids via conversationListStore, THEN
// calls backgroundTaskRosterStore.getState().resetRostersFor(ids) — see below
```

Reactive-only — like `queueBridge` and `sessionIdBridge`, the daemon pushes all three frames unsolicited,
so there is no request half. Each translator is a pure single-arm filter, unconditional: there is
deliberately no `if (event.tasks.length === 0) return null` on the roster side, since an empty roster is
the frame's payoff signal (AC5, ex-AC4), not "no news"; there is likewise no `if (event.patch)` on the
update side, since `patch: ''` always arrives on the wire (no `omitempty`) and is a value meaning "claude
sent no change". The guards downstream are all `!== null`, which pin *filtering*, not *truthiness* (a
snapshot object is truthy even when its `tasks` are empty or its `patch` is `''`). `default: null` on all
three, not `assertNever`: this is an independent subscriber in the `queueBridge`/`sessionIdBridge`
posture, not one of the three typecheck-gating exhaustive bridges — which already no-op all three arms
from #564/#565/#566. `translateBackgroundTaskRoster` is behaviourally unchanged by the #576/#577 reshapes
— the row → `HeldBackgroundTask` mapping happens inside `setRoster`, not the translator, because that is
where the prior state the join needs lives. The three arms are mutually exclusive, so the subscriber's
branches short-circuit in order (`connected` → roster → started → updated) and each matched branch
returns; order is a readability choice, not a correctness one.

**The `connected` reset enforces half of a security requirement (#573's AC5); the other half moved to
`clearAllRosters` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)).** Until #1139 this
branch was the SOLE enforcement, wholesale: the relay re-emits `connected` on every (re)handshake and a
new pairing always re-handshakes, so a nullary reset here stopped a previous pairing's literal command
lines (`description`, for `local_bash`-typed tasks, and `patch`, whose keys may carry the same class of
text under a structured-looking shape — #577) from surviving into a new one. Since #1117 the app holds one
connection per paired server, so `connected` means "*this* server's connection came back", and #1139
scoped the reset to that server's own listed conversations (via `originOf`, reading #1068's client-bound
stamp, never `event.ack`). Scoping keeps the *reconnect* half of AC5 — the reconnecting server's own
previous connection never leaks forward — but retires the *previous-pairing* half: a new pairing's first
`connected` resolves an empty conversation list, matches no held roster, and would otherwise drop nothing
at all. That half now lives in `clearAllRosters`, in [`clearPairingScopedState`](paired-shell.md#related)'s
dep set — this store is no longer excluded from it (see § Related).

The reset is still a leading branch in `subscribeBackgroundTaskRoster` *before* any translator runs — the
`queueBridge` posture, not `modalBridge`'s `reconnected`-as-translator-action posture — because each
translator returns a **value** (a snapshot), and folding the reset into any of them would force its return
type to widen into an action union, destroying the property that a translator is a pure arm→snapshot
filter. That property is also why #576 and #577 each added a **sibling** translator (for
`backgroundTaskStarted`, then `backgroundTaskUpdated`) rather than widening
`translateBackgroundTaskRoster`'s return type into a tagged union. Turning the origin into conversation
ids is the *caller's* job (`BackgroundTaskRosterData`, via #1086's `selectConversationIdsFor`), so the
bridge itself stays store-free and drivable with a plain spy — `originOf` is a module-private copy of the
`queueBridge`/`relayLinkBridge`/`conversationListBridge`/`daemonEventBridge` idiom, not an import, for the
reason each of those states.

`BackgroundTaskRosterData` derefs `window.pyry` only inside its effect, never during render, so it
server-renders to `''` without a bridge mock — the `QueueData`/`SessionIdData` invariant `App.test.tsx`'s
no-window-stub `<App/>` render depends on. Its name and props are unchanged by the #576 join, so
`App.tsx` itself is untouched.

### Data flow

```
App mount → <BackgroundTaskRosterData/> (app-level, seventh headless leaf)
  → subscribe effect: window.pyry.onDaemonEvent → subscribeBackgroundTaskRoster (live immediately, no request)

daemon → background_task_roster frame → parseBackgroundTaskRosterPayload → backgroundTaskRoster DaemonEvent [#566]
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener
    → translateBackgroundTaskRoster → { conversationId, tasks, droppedTasks } (or null → skip)
    → backgroundTaskRosterStore.setRoster(snapshot)
      [rebuilds the task map in row order; keeps a started-sourced record unchanged, rebuilds every other
       row fresh with toolCallId: null — membership stays replacement truth regardless of provenance]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (read by #568, not yet built)

daemon → background_task_started frame → parseBackgroundTaskStartedPayload → backgroundTaskStarted DaemonEvent [#564]
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener (roster translator returns null first)
    → translateBackgroundTaskStarted → { conversationId, taskId, toolCallId, taskType, description, truncatedFields }
    → backgroundTaskRosterStore.setStartedTask(snapshot)
      [upserts in place — creates the conversation's entry if none exists; preserves droppedTasks
       AND a held latestUpdate; description/taskType/truncatedFields replace whatever the task held]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (read by #568, not yet built)

daemon → background_task_updated frame → parseBackgroundTaskUpdatedPayload → backgroundTaskUpdated DaemonEvent [#565]
  (the DaemonEvent gained status/summary under #1560 — the family's only finish signal, both crossing
   verbatim, '' included; this listener reads neither, so the snapshot below is unchanged)
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener (roster + started translators return null first)
    → translateBackgroundTaskUpdated → { conversationId, taskId, patch, truncatedFields }
    → backgroundTaskRosterStore.setUpdatedTask(snapshot)
      [joins on conversationId + taskId, never on order; miss on unknown conversation OR unknown taskId
       returns state unchanged, silently; on a hit replaces latestUpdate wholesale, touches nothing else]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (read by #568, not yet built) [#577]

relay (re)handshake → daemonConnection.ts emits connected DaemonEvent, stamped with its origin (#1068)
  → DAEMON_EVENT_CHANNEL (in-order) → subscribeBackgroundTaskRoster listener
    → originOf(event) → ConversationListOrigin (#1068's stamp, never event.ack)   [#1139]
    → selectConversationIdsFor(origin)(conversationListStore.getState())   [#1086, this server's ids]
    → backgroundTaskRosterStore.resetRostersFor(ids)   [only the listed keys dropped — started-sourced
                                                         tasks and recorded patches go with them — or
                                                         same-ref no-op if none match]
  → then the daemon's reconcile burst arrives on the SAME channel, one background_task_roster per
    conversation whose bound session has reported one (pyrycode#2077-#2080, #569): each lands through
    the ordinary setRoster(snapshot) path above, correlated by conversationId and not by burst position
  → a conversation ABSENT from the burst stays dropped → selectRosterFor reads null ("No background-task
    report yet"); one re-asserted with tasks: [] reads observed-empty ("No background tasks")
  → backgroundTaskStarted/backgroundTaskUpdated are NOT in the reconcile set, so a started-sourced task's
    toolCallId and fuller label do not survive — it comes back roster-sourced only

pairing ends (unpair only, since #1141 — pairing another server adds a server rather than ending one) → clearPairingScopedState()   [#1139]
  → backgroundTaskRosterStore.clearAllRosters()   [every conversation's roster dropped, or same-ref
                                                    no-op if already empty]
```

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, as the **seventh** headless leaf, after
  `<RelayLinkData/>` — one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route
  flips, because either frame can arrive before #568's panel is ever mounted, and for a conversation the
  user is not looking at. The inline numbered leaf comments in `App.tsx` stop at "fifth" (`RelayLinkData`
  landed without one) — count the JSX, not the comments.
- No import surface yet: `useBackgroundTaskRosterStore`/`selectRosterFor` have no consumer. #568 is the
  first reader.
- `tasks` is a **display** map — its collection shape is not an invitation to iterate it as a work list
  something acts on. Nothing in this store or its bridge iterates it.
- `clearAllRosters` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)) is wired into
  `PairedShell.tsx`'s shared `clearPairingDeps` object, beside `clearAllBacklogs`, and invoked only from
  [`clearPairingScopedState`](paired-shell.md#related) — never from a bridge arm or directly from a
  component. Neither `clearPairingScopedState` call site needed an edit: per-path divergence is the exact
  bug that helper exists to prevent.

## Edge cases and limitations

- **No two-way binding.** `setRoster`/`setStartedTask`/`resetRostersFor`/`clearAllRosters` are invoked
  only by `subscribeBackgroundTaskRoster`'s wiring and `clearPairingScopedState`; components read
  exclusively through `selectRosterFor`.
- **No coercion or validation on either write path.** The store trusts #566's and #564's fail-closed
  decode completely. The wire row → `HeldBackgroundTask` mapping inside `setRoster` is a straight,
  named-field copy with no defaulting or derivation except `toolCallId: null` for a roster-sourced row —
  the one value in the held shape not sourced from the wire, deliberately outside the identifier domain
  so it cannot be mistaken for a real tool-call id.
- **`description` and `patch` are both untrusted, model-influenced daemon-relayed text.** `description`
  for `taskType: local_bash` is the literal command line claude ran; `patch`'s keys may carry the same
  class of text under a more tempting, structured-looking shape (JSON-like, but not guaranteed parseable
  — the daemon truncates it at construction, so a truncated object no longer parses). This slice has no
  DOM sink itself and runs no `JSON.parse`, key enumeration, or derived state on `patch` — #568 (not yet
  built) must render both as inert plain text only, never `innerHTML`/`dangerouslySetInnerHTML`, an
  attribute, or a URL, and must never execute or re-shell either. A reader that wants `patch`'s keys must
  parse behind an error branch that falls back to inert text, and must never enumerate a closed key set.
- **`patch`'s `truncatedFields` reports the cap cut only.** The daemon also scrubs invalid UTF-8 by
  deletion, so `patch` may differ from claude's bytes without appearing in that list — it is recorded,
  never cross-checked against the patch text.
- **Repopulated after a reconnect, roster-only, since [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569).**
  Like `queue_state`, `background_task_roster` joined the daemon's reconcile-on-connect set upstream
  (pyrycode#2077-#2080): on any (re)connection the daemon unicasts one roster per conversation whose
  bound session has reported one, and each lands through the ordinary `setRoster` path. The two silences
  stay apart — a conversation reconciled with an explicit empty roster reads observed-empty; one absent
  from the burst stays dropped and reads `null` from `selectRosterFor` until claude next emits a frame.
  `backgroundTaskStarted`/`backgroundTaskUpdated` are **not** in the reconcile set, so a started-sourced
  task's `toolCallId` and fuller label do not survive a reconnect — it comes back roster-sourced, a real
  narrowing pinned by a store test. Proved end-to-end through the real transport (not merely modeled) by
  `e2e/background-task-reconnect.spec.ts`.
- **A roster held for a conversation in no server's list survives every scoped reset**
  ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)) — the accepted consequence of
  scoping the reconnect edge by the conversation list rather than by anything wider, and a real case here
  rather than a corner one: a `backgroundTaskStarted` frame can arrive for a conversation whose list has
  not arrived yet. Pinned by a dedicated test so a later widening of the scope is a deliberate change.
  Because no `connected` edge ever reaches it, its retention window is "until the pairing ends" rather
  than "until the next connect" — `clearAllRosters` is the only thing that ever collects it, accepted on
  the same ~5 KB-per-task bound the store's header already carries, from a bounded-frame stream with no
  observed exhaustion.
- **Scoping the reconnect reset retired the argument that kept this store out of
  `clearPairingScopedState`.** Before [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139),
  the `connected` edge's nullary whole-map clear meant a re-pairing's first `connected` blanked every
  latched roster on its way past, so a dedicated pairing-boundary clear would have been dead code. Once
  the edge scoped to the reconnecting server's own conversations, the new pairing's first `connected`
  instead resolves an *empty* conversation list and drops nothing — and, at the time, this family had no
  re-assertion path of any kind, so a departed pairing's rosters would otherwise have rendered
  indefinitely, forever attributed to a machine the operator has left. Since #569 the daemon's reconcile
  does re-assert a roster, but only for the conversations of the pairing that reported them, so a departed
  pairing's is never reached and the same risk stands. #1139 closed it with `clearAllRosters` (see § How it
  works) — the same sequence [`conversationListStore`'s AC5](conversation-list-store.md#edge-cases-and-limitations)
  and [`queueStore`](queue-store.md#edge-cases-and-limitations) each ran through one ticket earlier: a
  store's exclusion from `clearPairingScopedState` is a claim about a *different* mechanism keeping it
  fresh, and that claim can go stale without anyone touching the store itself.
- **No terminal/finished state modelled, and a patch is never a finish signal.** The daemon reports no
  finish; a task's disappearance from a later roster is the only removal path this family has, whether it
  was roster-sourced or started-sourced or has a recorded patch, and any "finished" conclusion is left to
  #568 to draw and own, not invented here.
- **A started-only task can outlive its usefulness until the next eviction it is reachable by.** The
  daemon emits a roster only when claude emits one — it synthesises none — so a `backgroundTaskStarted`
  for a conversation that never receives a subsequent roster is held until something clears it. Since
  [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) that is "its server's next `connected`
  edge, if its conversation is listed" — narrower than the pre-#1139 whole-map reset, since the reset now
  reaches only its own server's own listed conversations — or, for a conversation no server's list ever
  named, "the next pairing boundary" (`clearAllRosters`). Bounded per task (~5 KB, by the daemon's
  per-frame caps) but not bounded in count; named and accepted in #576's spec rather than defended with a
  speculative eviction policy, since the failure has not been observed.
- **`latestUpdate` is latest-wins, deliberately not a history.** An append-only list keyed by a
  model-influenced `task_id`, fed by the daemon's push stream, would be unbounded growth on
  attacker-influenceable input; the daemon's own per-frame cap (`maxTaskPatch`, 4 KiB) is per frame, not
  per task, so only "one held record per task" keeps the bound meaningful (#577).
- **No reader wired in this slice.** Shipped populated and unread through #573/#576/#577 — #568 (the
  panel) was still open. **#581 is now the first reader** — see below. **#1435 is the second**: the
  composer status row's trailing slot reads `tasks.size + droppedTasks` — the true roster size this
  docblock names — as a plain count, never iterating `tasks` or reading `description`/`latestUpdate.patch`.
  See [Composer status row § Background-task count pill](conversation-shell-composer-status.md#background-task-count-pill-the-slots-last-occupant-1435).

## Related

- [Daemon-event channel](daemon-event-channel.md) / [#566 codebase notes](../codebase/566.md) / [#564
  codebase notes](../codebase/564.md) — the transport half this store consumes (`backgroundTaskRoster`
  and `backgroundTaskStarted` events, `BackgroundTask` wire row type); both shipped first, neither's wire
  contract touched by this store's reshapes.
- [Queue store](queue-store.md) / [#293 codebase notes](../codebase/293.md) / [#197 codebase
  notes](../codebase/197.md) — the exact structural precedent this store mirrors (daemon-state snapshot,
  keyed by conversation, store + bridge, render deferred) and the one thing that must **not** be cloned
  from it: `selectBacklogFor`'s `?? EMPTY_BACKLOG` collapse, which would silently violate this store's
  AC5 (never-observed vs. observed-empty). [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)
  scoped `queueStore`'s own `connected` reset one week before
  [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) ran the identical argument here, at
  the time one notch harsher: `queue_state` re-asserted a non-empty conversation while this family
  re-asserted nothing, ever. [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569) retired that comparison — the roster now has a
  re-assertion path too, so the two families sit at the *same* notch: each re-asserts on the reconnecting
  server's edge and neither reaches a conversation whose pairing has since ended.
- [Modal store + bridge](modal-store-bridge.md) — the rejected alternative posture for the `connected`
  edge (folded into the translator as a `reconnected` action); this store takes the `queueBridge` posture
  instead, since each translator returns a value rather than a member of an action union.
- [`clearPairingScopedState`](paired-shell.md#related) —
  [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) added this store's `clearAllRosters`
  as the dep set's twelfth member. **This store used to be that helper's header's own named
  counter-example** — cited as a store the `connected` edge already clears for its own reasons, so it
  "does not belong here at all". Scoping the edge to the reconnecting server retired that claim: a new
  pairing's first `connected` resolves an empty conversation list and drops nothing, so the store now
  answers YES to the header's discriminator ("does a reconnect to the same daemon need to clear it?") and
  still belongs in the set — the same split `queueStore` already lives with since #1138.
- [#573 codebase notes](../codebase/573.md) — the original roster-only shape; its § "Open questions
  carried forward" (lines 74-78) predicted a widened per-conversation entry that #576's and #577's specs
  both found impossible — disbelieve that section; see [#577's codebase notes](../codebase/577.md) §
  "Correcting a stale prediction still on disk" for the correction of record.
- [#576 codebase notes](../codebase/576.md) — the per-task join reshape (`HeldBackgroundTask`,
  `toolCallId` provenance predicate) this doc's shape builds on; its "Open mutation-control gap" is the
  SHOULD FIX #577's AC4 test closes.
- [#577 codebase notes](../codebase/577.md) — the `backgroundTaskUpdated`/`patch` join this doc now fully
  describes: the `latestUpdate` nested type, the `setUpdatedTask` setter, the third bridge translator, and
  the trap in the `setRoster` rebuild branch (a field that "no roster row can report" is two different
  kinds, and picking the wrong kind is silent and untested by any pre-existing test).
- [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) · Spec:
  `docs/specs/architecture/1139-background-task-roster-reconnect-reset-scoped-to-server.md` — scopes the
  `connected` reset to the reconnecting server (`resetRostersFor`, replacing the nullary `resetRosters`)
  and adds the pairing-boundary `clearAllRosters`, applying [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)'s
  `queueStore` fix here on what was then the harsher case: this family had no re-assertion path at all,
  and the content at risk (`description`/`patch`) is a literal shell command line, not a queued message's
  `text`. [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569) later gave the family a re-assertion path, narrowing but not closing the gap
  this ticket's `clearAllRosters` covers. Security
  review PASS with one MUST FIX (the pairing boundary), fixed in the design as shipped; two OUT OF SCOPE
  findings deferred to #1089 (a hostile daemon's own conversation-list contents narrowing a reset's scope,
  and the store's pre-existing conversation-id-only keying letting a daemon cross-attribute a roster to
  the wrong server's view — neither introduced nor fixed by this ticket).
- [Slash-command-list store](slash-command-list-store.md) — the shape this store lent onward: keyed
  `ReadonlyMap`, copy-on-write, `?? null` selector. That store deliberately did **not** copy this
  store's `connected` reset branch — which, at the time, was the sole enforcement of this store's own
  AC5; since [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) that enforcement is split
  across the scoped `connected` edge and `clearAllRosters` (see the `clearPairingScopedState` entry
  above).
- [#581 codebase notes](../codebase/581.md) / [Conversation shell — Background-task
  panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583) — the store's first real reader: the shell of
  #568's panel (split three ways: #581 → #582 → #583), reading `selectRosterFor(conversationId)` and
  rendering only `description` + `taskType` per held task. `droppedTasks`/`truncatedFields` remain
  unread until #582; `latestUpdate`/`patch` remain unread until #583. Since [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569), the panel
  reads a still-live task list after a reconnect too, because the daemon's own reconcile repopulates the
  store the panel reads from.
- **#569** — proved that the `connected`-edge clear and the daemon's reconcile-on-connect burst
  (pyrycode#2077-#2080) land in that order through the real transport, so a roster re-asserted at connect
  time is never wiped by the clear that precedes it. No production code changed: the store, the bridge
  and the panel already composed correctly (see § What it does, § How it works → Data flow, and § Edge
  cases above, all updated in place). One new spec, `e2e/background-task-reconnect.spec.ts`, drives a
  genuine reconnect through `launchPairedApp`'s `reconnectResendFrames` (#416's harness) and pins the two
  silences apart across it. Plan: `docs/specs/architecture/569-background-task-roster-reconnect.md`.
