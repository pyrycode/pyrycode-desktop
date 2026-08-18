# Background-task roster store

The renderer's held copy of each open conversation's live background-task set — a dedicated,
unidirectional Zustand store fed by a headless subscription binding that observes the [daemon-event
channel](daemon-event-channel.md)'s `backgroundTaskRoster` arm, so the still-unbuilt panel slice (#568)
will read one source of truth once it lands.

Introduced in [#573](../codebase/573.md), split from #567 alongside #574 (the two scalar arms,
`backgroundTaskStarted`/`backgroundTaskUpdated`, still pending). This ticket shipped no visible surface —
the store is populated and unread, deliberately, the same posture #564/#565/#566 already shipped for the
underlying wire arms. #568 (panel) and #574 (scalar-arm widening) are both still open.

## What it does

Holds each conversation's most recently reported background-task roster — `{ tasks, droppedTasks }`,
`tasks` a `readonly BackgroundTask[]` of `{ task_id, task_type, description, truncated_fields }` rows held
**verbatim by reference, snake_case** — keyed by `conversationId`, and **replaces** a key's held entry
wholesale on every `backgroundTaskRoster` frame for that conversation: a task present in an earlier roster
and absent from a later one is simply no longer held, since absence from a later roster is this family's
only removal path (there is no terminal/finish event by design). An empty roster (`tasks: []`) still
writes an entry — it is the daemon's positive statement "nothing is alive for this conversation" — and is
never dropped, filtered, or coalesced as "no news". Deliberately **not** a [session store](session-store.md)
or [timeline store](conversation-timeline-store.md) facet: like `queue_state`, `background_task_roster` is
daemon *state* (SSOT pyrycode #720), not part of claude's turn stream, so it gets its own store rather
than folding into `reduceTimeline`.

On the `connected` daemon edge — every (re)handshake, including a fresh pairing — the store clears every
conversation's held entry wholesale and does **not** repopulate: rosters are not in the daemon's
reconcile-on-connect set (that set is outstanding `modal_shown` per pyrycode#877 and `queue_state` per
non-empty backlog per pyrycode#878), and this app advertises no `last_event_id`, so no replay arrives
either. A conversation reads "no roster observed" after a reconnect until claude next emits one — the
honest behaviour, since retaining the pre-disconnect set would present a stale list as live. Closing that
gap needs a daemon-side change and is #569's subject, not this store's.

## How it works

### The store (`src/renderer/src/store/backgroundTaskRosterStore.ts`)

```ts
export interface BackgroundTaskRosterEntry {
  tasks: readonly BackgroundTask[]     // wire rows, snake_case, by reference
  droppedTasks: number                 // this frame's ONLY truncation report; true size = tasks.length + droppedTasks
}
export interface BackgroundTaskRosterSnapshot extends BackgroundTaskRosterEntry {
  conversationId: string
}
export interface BackgroundTaskRosterState {
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>   // key absent = no roster has ever arrived
}
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  resetRosters: () => void
}

createBackgroundTaskRosterStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
backgroundTaskRosterStore                  // app-wide singleton
useBackgroundTaskRosterStore(selector)     // narrow-slice React binding: useStore(store, selector)
selectRosterFor(conversationId)(state)     // selector FACTORY — the primary read surface (#568), returns `?? null`
```

Keyed by `conversationId`, not a flat slot, for the same reason [`queueStore`](queue-store.md) is: the
daemon fans these frames out to every interactive connection and each carries `conversation_id`, so
rosters for *different* conversations can arrive back-to-back and a flat "hold the latest roster" slot
would let one clobber another. **Two named setters** (`setRoster`, `resetRosters`), not a reducer — the
same call `queueStore` made, for the same reason: two operations don't justify a discriminated-union
action set. Mirrors `queueStore`'s DI-factory → singleton → hook → selector structure and its
`ReadonlyMap` copy-on-write idiom: `setRoster` clones the map, sets the key to a **fresh named-field
entry** `{ tasks, droppedTasks }` (never `return event`, never a spread — the field-add safety this buys
is concrete here, since #574 widens this entry with `toolCallId`/`patch` and a spread would silently start
carrying fields this slice never agreed to hold), and replaces. The write is **unconditional**: `tasks: []`
sets that key to an entry holding no rows, it does not delete the key.

**The one place the `queueStore` precedent is deliberately *not* cloned.** `queueStore.selectBacklogFor`
returns `s.backlogs.get(id) ?? EMPTY_BACKLOG`, collapsing "never observed" and "observed, empty" into the
same bare `[]` — correct for `queue_state`, but this store needs the two distinguishable (AC4). The fix is
`selectRosterFor`'s `?? null` instead of `?? EMPTY_BACKLOG`, typed `BackgroundTaskRosterEntry | null`:

| store contents for `c1` | `selectRosterFor('c1')` | meaning |
| --- | --- | --- |
| key absent | `null` | no roster has ever arrived for this conversation |
| `{ tasks: [], droppedTasks: 0 }` | that entry | observed, nothing alive |
| `{ tasks: [t], droppedTasks: 2 }` | that entry | 1 row carried, 3 truly alive |

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

subscribeBackgroundTaskRoster(onDaemonEvent, setRoster, resetRosters): () => void
// onDaemonEvent(event => {
//   if (event.type === 'connected') { resetRosters(); return }
//   const s = translateBackgroundTaskRoster(event); if (s !== null) setRoster(s)
// })

BackgroundTaskRosterData(): null
// headless component, one subscribe effect (deps []), mounted app-level in App.tsx as the SEVENTH leaf
```

Reactive-only — like `queueBridge` and `sessionIdBridge`, the daemon pushes the roster unsolicited, so
there is no request half. `translateBackgroundTaskRoster` is unconditional: there is deliberately no
`if (event.tasks.length === 0) return null`, since an empty roster is the frame's payoff signal (AC4), not
"no news" — the guard downstream is `snapshot !== null`, which pins *filtering*, not *truthiness* (a
snapshot object is truthy even when its `tasks` are empty). `default: null`, not `assertNever`: this is an
independent subscriber in the `queueBridge`/`sessionIdBridge` posture, not one of the three
typecheck-gating exhaustive bridges — which already no-op this arm from #566.

**The `connected` reset is the sole enforcement of a security requirement (AC5), not a feature nicety.**
The relay re-emits `connected` on every (re)handshake and a new pairing always re-handshakes, so this
branch is what stops a previous pairing's literal command lines (`description` for `task_type:
local_bash`-typed rows) from surviving into a new one. It is a leading branch in `subscribeBackgroundTaskRoster`
*before* the translator runs — the `queueBridge` posture, not `modalBridge`'s `reconnected`-as-translator-
action posture — because this translator returns a **value** (a snapshot), and folding the reset in would
force the return type to `Snapshot | 'reset' | null`, destroying the property that the translator is a
pure `backgroundTaskRoster`→snapshot filter. Per the same logic that already excludes `queueStore` and
`modalStore`, this store is **not** added to `clearPairingScopedState.ts` — that helper's docstring
excludes stores the `connected` edge already clears, and the `connected` edge subsumes the pairing-scoped
clear here too.

`BackgroundTaskRosterData` derefs `window.pyry` only inside its effect, never during render, so it
server-renders to `''` without a bridge mock — the `QueueData`/`SessionIdData` invariant `App.test.tsx`'s
no-window-stub `<App/>` render depends on.

### Data flow

```
App mount → <BackgroundTaskRosterData/> (app-level, seventh headless leaf)
  → subscribe effect: window.pyry.onDaemonEvent → subscribeBackgroundTaskRoster (live immediately, no request)

daemon → background_task_roster frame → parseBackgroundTaskRosterPayload → backgroundTaskRoster DaemonEvent [#566]
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener
    → translateBackgroundTaskRoster → { conversationId, tasks, droppedTasks } (or null → skip)
    → backgroundTaskRosterStore.setRoster(snapshot)   [replacement-truth, per conversationId key]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (read by #568, not yet built)

relay (re)handshake → daemonConnection.ts emits connected DaemonEvent
  → DAEMON_EVENT_CHANNEL (in-order) → subscribeBackgroundTaskRoster listener
    → resetRosters()   [whole map cleared, or same-ref no-op if already empty]
  → NOT repopulated: rosters aren't in the daemon's reconcile-on-connect set (#569 territory)
```

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, as the **seventh** headless leaf, after
  `<RelayLinkData/>` — one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route
  flips, because a roster can arrive before #568's panel is ever mounted, and for a conversation the user
  is not looking at. The inline numbered leaf comments in `App.tsx` stop at "fifth" (`RelayLinkData`
  landed without one) — count the JSX, not the comments.
- No import surface yet: `useBackgroundTaskRosterStore`/`selectRosterFor` have no consumer. #568 is the
  first reader.
- `tasks` is a **display** list — its list shape is not an invitation to iterate it as a work list
  something acts on. Nothing in this store or its bridge iterates it.

## Edge cases and limitations

- **No two-way binding.** `setRoster`/`resetRosters` are invoked only by
  `subscribeBackgroundTaskRoster`'s wiring; components read exclusively through `selectRosterFor`.
- **No coercion or validation of `tasks`/`droppedTasks`.** The store trusts #566's fail-closed decode
  completely; rows arrive snake_case and untouched.
- **`description` is untrusted, model-influenced daemon-relayed text**, and for `task_type: local_bash`
  is the literal command line claude ran. This slice has no DOM sink itself — #568 (not yet built) must
  render it as inert plain text only, never `innerHTML`/`dangerouslySetInnerHTML`, an attribute, or a URL,
  and must never execute or re-shell it.
- **No repopulation after a reconnect.** Unlike `queue_state`, the roster is not in the daemon's
  reconcile-on-connect set, and this app sends no `last_event_id`, so no replay arrives either. A
  conversation reads `null` from `selectRosterFor` after a reconnect until claude next emits a roster.
  Closing that gap is #569's subject and needs a daemon-side change.
- **No terminal/finished state modelled.** The daemon reports no finish; a task's disappearance from a
  later roster is the only removal path this family has, and any "finished" conclusion is left to #568 to
  draw and own, not invented here.
- **No `toolCallId`/`patch`.** A roster row carries exactly four wire facts (`task_id`, `task_type`,
  `description`, `truncated_fields`) and this store does not blank-fill the two scalar-arm-only facts.
  #574 is expected to widen `BackgroundTaskRosterEntry` with those two as optional, carried over for
  surviving rows across a roster replacement — not pre-built here.
- **No reader wired in this slice.** Ships populated and unread — #568 owns the panel, and no consumer of
  `useBackgroundTaskRosterStore`/`selectRosterFor` ships until then.

## Related

- [Daemon-event channel](daemon-event-channel.md) / [#566 codebase notes](../codebase/566.md) — the
  transport half this store consumes (`backgroundTaskRoster` event, `BackgroundTask` wire row type);
  shipped first, unchanged by this ticket.
- [Queue store](queue-store.md) / [#293 codebase notes](../codebase/293.md) / [#197 codebase
  notes](../codebase/197.md) — the exact structural precedent this store mirrors (daemon-state snapshot,
  keyed by conversation, store + bridge, render deferred) and the one thing that must **not** be cloned
  from it: `selectBacklogFor`'s `?? EMPTY_BACKLOG` collapse, which would silently violate this store's
  AC4 (never-observed vs. observed-empty).
- [Modal store + bridge](modal-store-bridge.md) — the rejected alternative posture for the `connected`
  edge (folded into the translator as a `reconnected` action); this store takes the `queueBridge` posture
  instead, since the modal translator returns members of an action union and this one returns a value.
- [`clearPairingScopedState`](daemon-connection.md) — the membership rule (a store the `connected` edge
  already clears "does not belong here at all") that explains why this store is deliberately absent from
  it, matching `queueStore` and `modalStore`.
- [#573 codebase notes](../codebase/573.md) — implementation summary and patterns established.
- Feeds the still-unbuilt panel #568, which owns rendering every row's `description` as inert text. #574
  (open) owns the two scalar arms (`backgroundTaskStarted`/`backgroundTaskUpdated`) and is expected to
  widen `BackgroundTaskRosterEntry` with their `toolCallId`/`patch`. #569 (open) owns repopulation after a
  reconnect and needs a daemon-side change first.
