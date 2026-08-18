# Background-task roster store

The renderer's held copy of each open conversation's live background-task set — a dedicated,
unidirectional Zustand store fed by a headless subscription binding that observes the [daemon-event
channel](daemon-event-channel.md)'s `backgroundTaskRoster` **and** `backgroundTaskStarted` arms, joining
them per task so the still-unbuilt panel slice (#568) will read one source of truth once it lands.

Introduced in [#573](../codebase/573.md), split from #567 alongside #574 (the two scalar arms,
`backgroundTaskStarted`/`backgroundTaskUpdated`). #574 was itself later split into [#576](../codebase/576.md)
(this doc's current shape — joins `backgroundTaskStarted`) and #577 (open — `backgroundTaskUpdated`/
`patch`). Neither #573 nor #576 shipped a visible surface — the store is populated and unread,
deliberately, the same posture #564/#565/#566 already shipped for the underlying wire arms. #568 (panel)
and #577 (the last scalar arm) are both still open.

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

Deliberately **not** a [session store](session-store.md) or [timeline store](conversation-timeline-store.md)
facet: like `queue_state`, this family is daemon *state* (SSOT pyrycode #720), not part of claude's turn
stream, so it gets its own store rather than folding into `reduceTimeline`.

On the `connected` daemon edge — every (re)handshake, including a fresh pairing — the store clears every
conversation's held entry wholesale, started-sourced and roster-sourced tasks alike, and does **not**
repopulate: neither frame is in the daemon's reconcile-on-connect set (that set is outstanding
`modal_shown` per pyrycode#877 and `queue_state` per non-empty backlog per pyrycode#878), and this app
advertises no `last_event_id`, so no replay arrives either. A conversation reads "nothing observed" after
a reconnect until claude next emits a frame — the honest behaviour, since retaining the pre-disconnect set
would present a stale list as live. Closing that gap needs a daemon-side change and is #569's subject, not
this store's.

## How it works

### The store (`src/renderer/src/store/backgroundTaskRosterStore.ts`)

```ts
export interface HeldBackgroundTask {                          // per-task, renderer-side camelCase (#576)
  taskId: string
  toolCallId: string | null       // null = roster-sourced; only a started frame ever reports one
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
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
export interface BackgroundTaskRosterState {
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>   // key absent = no frame has ever arrived
}
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void   // #576
  resetRosters: () => void
}

createBackgroundTaskRosterStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
backgroundTaskRosterStore                  // app-wide singleton
useBackgroundTaskRosterStore(selector)     // narrow-slice React binding: useStore(store, selector)
selectRosterFor(conversationId)(state)     // selector FACTORY — the primary read surface (#568), returns `?? null`
```

Keyed by `conversationId`, not a flat slot, for the same reason [`queueStore`](queue-store.md) is: the
daemon fans these frames out to every interactive connection and each carries `conversation_id`, so
frames for *different* conversations can arrive back-to-back and a flat "hold the latest" slot would let
one clobber another. **Three named setters** (`setRoster`, `setStartedTask`, `resetRosters`), not a
reducer — three operations still don't justify a discriminated-union action set. Mirrors `queueStore`'s
DI-factory → singleton → hook → selector structure and its `ReadonlyMap` copy-on-write idiom throughout:
clone the outer map, clone the inner map, replace; never mutate `s.rosters`, an entry, or an entry's
`tasks` in place.

`setRoster` (#576 reshape) rebuilds the conversation's task map from the snapshot's rows **in row
order**: for each row, if a task is already held under that `task_id` **and is started-sourced**
(`toolCallId !== null`), the held record is kept unchanged — the started frame's label is authoritative
and never repeats, so refreshing from the row would throw away the fuller copy permanently (AC2).
Otherwise a fresh `HeldBackgroundTask` is built from the row with `toolCallId: null`. `droppedTasks` is
taken from the snapshot unconditionally. The write stays **unconditional**: an empty `tasks: []` still
writes an entry holding no tasks ("nothing is alive"), it does not delete the key.

`setStartedTask` (#576, new) upserts one task into its conversation's entry, **creating** the entry if no
frame has arrived for that conversation yet — claude orders these frames, not the daemon, so a started
frame can precede any roster for its conversation. `Map.set` keeps an existing key's position, so
upgrading a roster-held task in place preserves roster display order while a genuinely new task appends.
The snapshot's `description`/`taskType`/`truncatedFields` **replace** whatever the task held; the two
frames' `truncatedFields` lists name different vocabularies, so a started frame's list replaces rather
than unions with a roster row's. `droppedTasks` is **preserved** from the existing entry (or `0` on
create) — a started frame reports nothing about roster truncation and must not reset the count.

Provenance — "was this task's fuller label ever reported?" — is **derived, never stored**: exactly
`toolCallId !== null`. This must be tested with `!== null`, never truthiness: `requireString` (the
main-side decode helper) admits `''` as a valid `tool_call_id`, so a truthiness check would silently
demote a task whose id happens to be `''` back to roster-sourced and let the next roster overwrite its
fuller label.

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

`resetRosters` clears the **whole** map wholesale — `set({ rosters: new Map() })` — and returns the same
state reference when the map is already empty, so zustand's `Object.is` short-circuits and a first
`connected` (or a reconnect that held nothing) churns no listeners.

### The data path (`src/renderer/src/store/backgroundTaskRosterBridge.ts`)

```ts
translateBackgroundTaskRoster(event: DaemonEvent): BackgroundTaskRosterSnapshot | null
// switch (event.type) { case 'backgroundTaskRoster': return { conversationId, tasks, droppedTasks }; default: return null }

translateBackgroundTaskStarted(event: DaemonEvent): BackgroundTaskStartedSnapshot | null   // #576, sibling translator
// switch (event.type) { case 'backgroundTaskStarted': return { conversationId, taskId, toolCallId, taskType, description, truncatedFields }; default: return null }

subscribeBackgroundTaskRoster(onDaemonEvent, setRoster, resetRosters, setStartedTask): () => void   // fourth param, #576
// onDaemonEvent(event => {
//   if (event.type === 'connected') { resetRosters(); return }
//   const roster = translateBackgroundTaskRoster(event); if (roster !== null) { setRoster(roster); return }
//   const started = translateBackgroundTaskStarted(event); if (started !== null) setStartedTask(started)
// })

BackgroundTaskRosterData(): null
// headless component, one subscribe effect (deps []), mounted app-level in App.tsx as the SEVENTH leaf
```

Reactive-only — like `queueBridge` and `sessionIdBridge`, the daemon pushes both frames unsolicited, so
there is no request half. Each translator is a pure single-arm filter, unconditional: there is
deliberately no `if (event.tasks.length === 0) return null` on the roster side, since an empty roster is
the frame's payoff signal (AC5, ex-AC4), not "no news" — the guards downstream are both `!== null`, which
pin *filtering*, not *truthiness* (a snapshot object is truthy even when its `tasks` are empty).
`default: null` on both, not `assertNever`: this is an independent subscriber in the
`queueBridge`/`sessionIdBridge` posture, not one of the three typecheck-gating exhaustive bridges — which
already no-op both arms from #564/#566. `translateBackgroundTaskRoster` is behaviourally unchanged by the
#576 reshape — the row → `HeldBackgroundTask` mapping happens inside `setRoster`, not the translator,
because that is where the prior state the join needs lives. The two arms are mutually exclusive, so
the subscriber's roster branch returns before the started translator ever runs; `backgroundTaskUpdated`
stays dormant here, awaiting #577.

**The `connected` reset is the sole enforcement of a security requirement (AC5), not a feature nicety.**
The relay re-emits `connected` on every (re)handshake and a new pairing always re-handshakes, so this
branch is what stops a previous pairing's literal command lines (`description`, for `local_bash`-typed
tasks) from surviving into a new one — started-sourced tasks included. It is a leading branch in
`subscribeBackgroundTaskRoster` *before* either translator runs — the `queueBridge` posture, not
`modalBridge`'s `reconnected`-as-translator-action posture — because each translator returns a **value**
(a snapshot), and folding the reset into either would force its return type to widen into an action
union, destroying the property that a translator is a pure arm→snapshot filter. That property is also
why #576 added a **sibling** translator for `backgroundTaskStarted` rather than widening
`translateBackgroundTaskRoster`'s return type into a tagged union. Per the same logic that already
excludes `queueStore` and `modalStore`, this store is **not** added to `clearPairingScopedState.ts` —
that helper's docstring excludes stores the `connected` edge already clears, and the `connected` edge
subsumes the pairing-scoped clear here too.

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
      [upserts in place — creates the conversation's entry if none exists; preserves droppedTasks;
       description/taskType/truncatedFields replace whatever the task held]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (read by #568, not yet built)

relay (re)handshake → daemonConnection.ts emits connected DaemonEvent
  → DAEMON_EVENT_CHANNEL (in-order) → subscribeBackgroundTaskRoster listener
    → resetRosters()   [whole map cleared — started-sourced tasks too — or same-ref no-op if already empty]
  → NOT repopulated: neither frame is in the daemon's reconcile-on-connect set (#569 territory)
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

## Edge cases and limitations

- **No two-way binding.** `setRoster`/`setStartedTask`/`resetRosters` are invoked only by
  `subscribeBackgroundTaskRoster`'s wiring; components read exclusively through `selectRosterFor`.
- **No coercion or validation on either write path.** The store trusts #566's and #564's fail-closed
  decode completely. The wire row → `HeldBackgroundTask` mapping inside `setRoster` is a straight,
  named-field copy with no defaulting or derivation except `toolCallId: null` for a roster-sourced row —
  the one value in the held shape not sourced from the wire, deliberately outside the identifier domain
  so it cannot be mistaken for a real tool-call id.
- **`description` is untrusted, model-influenced daemon-relayed text**, and for `taskType: local_bash`
  is the literal command line claude ran. This slice has no DOM sink itself — #568 (not yet built) must
  render it as inert plain text only, never `innerHTML`/`dangerouslySetInnerHTML`, an attribute, or a URL,
  and must never execute or re-shell it.
- **No repopulation after a reconnect.** Unlike `queue_state`, neither frame is in the daemon's
  reconcile-on-connect set, and this app sends no `last_event_id`, so no replay arrives either. A
  conversation reads `null` from `selectRosterFor` after a reconnect until claude next emits either frame.
  Closing that gap is #569's subject and needs a daemon-side change.
- **No terminal/finished state modelled.** The daemon reports no finish; a task's disappearance from a
  later roster is the only removal path this family has, whether it was roster-sourced or
  started-sourced, and any "finished" conclusion is left to #568 to draw and own, not invented here.
- **A started-only task can outlive its usefulness until the next `connected` edge.** The daemon emits a
  roster only when claude emits one — it synthesises none — so a `backgroundTaskStarted` for a
  conversation that never receives a subsequent roster is held until the whole map is cleared on
  reconnect. Bounded per task (~5 KB, by the daemon's per-frame caps) but not bounded in count; named and
  accepted in #576's spec rather than defended with a speculative eviction policy, since the failure has
  not been observed.
- **No `patch` / `backgroundTaskUpdated`.** #577 (open) owns that arm and builds directly on the
  `HeldBackgroundTask` shape #576 introduced.
- **No reader wired in this slice.** Ships populated and unread — #568 owns the panel, and no consumer of
  `useBackgroundTaskRosterStore`/`selectRosterFor` ships until then.

## Related

- [Daemon-event channel](daemon-event-channel.md) / [#566 codebase notes](../codebase/566.md) / [#564
  codebase notes](../codebase/564.md) — the transport half this store consumes (`backgroundTaskRoster`
  and `backgroundTaskStarted` events, `BackgroundTask` wire row type); both shipped first, neither's wire
  contract touched by this store's reshapes.
- [Queue store](queue-store.md) / [#293 codebase notes](../codebase/293.md) / [#197 codebase
  notes](../codebase/197.md) — the exact structural precedent this store mirrors (daemon-state snapshot,
  keyed by conversation, store + bridge, render deferred) and the one thing that must **not** be cloned
  from it: `selectBacklogFor`'s `?? EMPTY_BACKLOG` collapse, which would silently violate this store's
  AC5 (never-observed vs. observed-empty).
- [Modal store + bridge](modal-store-bridge.md) — the rejected alternative posture for the `connected`
  edge (folded into the translator as a `reconnected` action); this store takes the `queueBridge` posture
  instead, since each translator returns a value rather than a member of an action union.
- [`clearPairingScopedState`](daemon-connection.md) — the membership rule (a store the `connected` edge
  already clears "does not belong here at all") that explains why this store is deliberately absent from
  it, matching `queueStore` and `modalStore`.
- [#573 codebase notes](../codebase/573.md) — the original roster-only shape; its § "Open questions
  carried forward" predicted a widened entry that #576's spec found impossible — disbelieve that section.
- [#576 codebase notes](../codebase/576.md) — the join reshape this doc now describes: implementation
  summary, patterns established, and an open mutation-control gap noted (not merge-blocking) by code
  review.
- Feeds the still-unbuilt panel #568, which owns rendering every task's `description` as inert text. #577
  (open) owns the last scalar arm, `backgroundTaskUpdated`/`patch`. #569 (open) owns repopulation after a
  reconnect and needs a daemon-side change first.
