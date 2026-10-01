# Run configuration write store

The renderer's **pending-write state machine** for a Model / Effort / Permission-mode / YOLO change: it holds a requested
change optimistically, then settles it to the daemon's confirmed result or rolls it back on rejection —
the state the interactive Run configuration controls ([#257](../codebase/257.md)) dispatch onto and read
back.

Introduced in [#256](../codebase/256.md), the last store-machine slice of #183's interactive
Run-configuration write path before the render consumer [#257](../codebase/257.md) (since shipped, PR
\#283). Consumes the two correlated daemon events [#261](../codebase/261.md) (`sessionSettingsUpdated`)
and [#269](../codebase/269.md) (`sessionSettingsRejected`), and drives the outbound
[session settings send](session-settings-send.md) (#263) command. This store itself delivers no visible
surface of its own — #257 is now its live consumer, the same posture `sessionIdStore` (#259) had before
\#257 and `runConfigStore` (#187) had before #188.

## What it does

Lets a caller dispatch a per-field settings change (`{field: 'model'|'effort'|'yolo'|'permissionMode', value}`), reflects
it immediately in the store's derived view, and resolves it — commit or roll back — when the matching
correlated daemon reply arrives. A confirm/reject whose correlation id matches no pending change is a
fail-closed no-op: it never commits or rolls back the wrong change, and two outstanding changes are told
apart by their own correlation ids.

## How it works

### The problem this store solves

`set_session_settings`'s acknowledgement carries `session_id`, not the chosen fields. The client
therefore retains the requested change under its correlation id to distinguish success from rejection.
That acknowledgement confirms a choice; it does not establish the model's applied effort. A successful
effort write requests fresh settings, whose separate `effectiveEffort` reading governs the footer.
The sheet and recall policy keep using this store's explicit-choice composition.

### The store (`src/renderer/src/store/runSettingsWriteStore.ts`)

```ts
export type SettingsChange =
  | { field: 'model'; value: string; source?: 'recall' }
  | { field: 'effort'; value: string }
  | { field: 'yolo'; value: boolean }
  | { field: 'permissionMode'; value: string }   // #1021 — plain string, no union, no allowlist

export type RunSettingsWriteEvent =
  | { type: 'changeDispatched'; changeId: string; change: SettingsChange }
  | { type: 'settingsConfirmed'; changeId: string }   // from sessionSettingsUpdated (#261)
  | { type: 'settingsRejected'; changeId: string }    // from sessionSettingsRejected (#269)
  | { type: 'reconnected' }                           // from the connected wire edge ([#539](../codebase/539.md))
  | { type: 'conversationSwitched' }                  // from activateConversation/exitActiveConversation (#1167)

export interface RunSettingsWriteState {
  pending: ReadonlyMap<string, SettingsChange>   // changeId → requested change
  confirmed: { model?: string; effort?: string; yolo?: boolean; permissionMode?: string }  // sparse client-confirmed overrides
  error: SettingsChange['field'] | null          // last-rejected field, or null
}

createRunSettingsWriteStore(init?)   // vanilla createStore — one isolated instance per test (DI seam)
runSettingsWriteStore                // app-wide singleton
useRunSettingsWriteStore(selector)   // React binding: useStore(runSettingsWriteStore, selector)
```

An **adjacent, dedicated store** — not a `runConfigStore` facet — for the same two reasons as
[`sessionIdStore`](session-id-store.md) (#259): (a) its inbound subscription must be **App-level
always-listening** (a confirm/reject reply can arrive after the sheet closes, whereas `runConfigStore`'s
subscriber is sheet-scoped); (b) its state (pending changes + client-confirmed overrides + last error) is
orthogonal to the snapshot's `{model, effort, yolo, permissionMode, usedTokens, windowTokens}` shape. Unlike
`sessionIdStore`'s named setters, this is a **reducer** (`dispatch` over the sealed event union) because
every one of its five transitions reads prior state: three (dispatch / confirm / reject) are
**correlated** — a confirm or reject is a no-op without a matching pending record — and the other two,
`reconnected` ([#539](../codebase/539.md)) and `conversationSwitched` (#1167), are uncorrelated (no
`changeId`) but still prior-state-reading, since each clears only when something is held. `sessionIdStore`'s
set and clear ([#529](../codebase/529.md)) — and `runConfigStore`'s, since #1167 — are independent
whole-value writes that read nothing. The contrast is the coupling, not the count.

### The reducer (five arms, each pinned by a named test)

- **`changeDispatched`** — `pending.set(changeId, change)`; clears `error` (a fresh attempt supersedes
  the last rejection). `confirmed` untouched — the optimistic value shows only through the pending
  overlay in `selectEffectiveSettings`.
- **`settingsConfirmed`** — looks up `pending.get(changeId)`; if absent, **no-op** (fail-closed); else
  commits **the value the client sent** (the event itself carries none) into `confirmed` and deletes the
  pending marker.
- **`settingsRejected`** — looks up `pending.get(changeId)`; if absent, **no-op** (fail-closed); else
  deletes the pending marker (the explicit-choice view rolls back — the optimistic overlay vanishes, revealing
  the last confirmed value or the snapshot base) and sets `error` to the rejected field.
  A model change with `source: 'recall'` preserves the existing error instead, so automatic
  new-chat rollback creates no ordinary user-pick error UI.
- **`reconnected`** ([#539](../codebase/539.md)) — admitted by the bridge only for the open chat's
  owning host; drops **every** pending marker, regardless of how many were outstanding, because main
  abandons that host's envelope-id → `changeId` correlation on each re-dial
  (`daemonConnection.ts` `dial()`) and emits no rejection in its place, so a change stranded by a
  reconnect can never resolve on its own — and since `pending` beats `confirmed` in
  `selectEffectiveSettings`, an unresolved stranded entry would otherwise outlive (and shadow) a later
  *confirmed* change on the same field forever. `confirmed` and `error` are left untouched: a standing
  rejection is still true after a reconnect, and a confirmed override is still what the daemon has. Same-
  reference no-op when `pending` is already empty — load-bearing, not cosmetic, because #257's container
  selects the **whole raw state** (`RunConfigSections.tsx:327`) as its zustand selector, so this is what
  keeps a reconnect with nothing in flight from re-rendering the sheet. A new `SettingsChange` arm never
  needs hand-wiring here (#1021 confirmed this for `permissionMode`): the arm lives *inside* the `pending`
  Map, which this reducer replaces wholesale, so the field is cleared for free. Contrast `confirmed` and
  `error`, which are per-field and would need an explicit new case if a future arm needed clearing on
  reconnect too.
- **`conversationSwitched`** (#1167) — drops `pending`, `confirmed` **and** `error` together, dispatched
  by `activateConversation`/`exitActiveConversation` rather than any bridge (no wire edge produces it —
  which chat is open is not a fact this store holds, so the two helpers own that decision and this store
  only obeys it). That is the whole of what distinguishes it from `reconnected`: a reconnect abandons
  correlations for a session that is still the one being described, while a switch changes *which*
  session is being described at all — so a standing rejection and a confirmed override, both still true
  across a reconnect, are both false across a switch. Two deliberate departures from `reconnected`:
  - **A fresh whole-state literal** (`{ pending: new Map(), confirmed: {}, error: null }`), not
    `{ ...state, … }`. `reconnected` spreads `state` so an unknown future field is preserved by default,
    matching its "clear only the thing that strands" posture; this arm's posture is the inverse — every
    field of this store is conversation-scoped — so the literal form makes a future required field a
    *compile error* here rather than a value silently preserved past the chat it described.
  - **The same-reference early-out spans all three fields**, not just `pending`: copying `reconnected`'s
    guard (`pending.size === 0`) verbatim would return early on exactly the state this arm exists for — a
    confirmed override standing with nothing pending — so this arm's guard is
    `pending.size === 0 && error === null && !hasConfirmed(confirmed)`, where `hasConfirmed` reads key
    presence on the sparse `confirmed` object (every writer is `applyConfirmed`, which only ever sets a
    real value, so presence *is* "held"). Load-bearing for the same reason `reconnected`'s is: #257's
    container selects the whole raw write state, so without it a switch between two chats that never
    wrote anything would re-render the sheet.

There is no explicit "roll back" mutation: **clearing the pending marker *is* the rollback**, because the
explicit-choice view falls through to the confirmed override or the snapshot base — `reconnected` and
`conversationSwitched` are two more callers of that doctrine, not a new mechanism. A no-match (or
already-clear) arm returns the same state object, so zustand skips the notify.

### The effective-view derivation

```ts
function selectEffectiveSettings(
  snapshot: RunConfigSnapshot | null,
  s: RunSettingsWriteState
): Pick<RunConfigSnapshot, 'model' | 'effort' | 'yolo' | 'permissionMode'>
```

Composes explicit settings for the sheet, sibling controls and recall, precedence high to low:

1. the **last-inserted** `pending` entry for that field, if any (optimistic; `Map` insertion order gives
   last-write-wins for rapid same-field changes);
2. else `confirmed[field]`, if set;
3. else the snapshot base (`snapshot?.model ?? ''`, `?? ''`, `?? false`, `snapshot?.permissionMode ?? ''`).

Despite the selector's name, its `effort` is an explicit choice, not Claude's applied reading.
The [effort footer](composer-effort-menu.md#the-write) uses `selectAppliedEffort` instead: pending
effort over `snapshot.effectiveEffort`, without the confirmed layer. This allows saved and applied
values to disagree without blocking recall or masking the daemon's fresh reading.

`??` falls through only on `undefined`, so an empty-string / `false` value at any layer is held verbatim
— never coerced (the `runConfigStore` no-coercion posture). `selectError(s)` and
`selectPendingFields(s): {model; effort; yolo; permissionMode}` (booleans) round out the read surface for
the sheet's in-flight UI state — `selectPendingFields` shipped with #256 but had no production consumer
until [#558](../codebase/558.md) rendered it as `aria-busy` on the owning control.

**The trap in widening either selector: the compiler forces a `case`, not a returned field.** Both
selectors iterate `s.pending.values()` through a per-field `switch` into local variables, then compose
those locals into the returned object as a second step. Adding a union arm and satisfying `assertNever`
only requires the `switch` to gain a `case` — nothing forces that case's value to actually reach the
return statement. A `case` that assigns its local and never threads it into the object below compiles
clean, keeps every existing test green, and leaves the new field's optimistic overlay (and its in-flight
flag) silently dead — a change that looks applied in the store and never reaches a reader. #1021 named
this explicitly and widened both return types by hand; a store spec that only asserts "the field exists on
the return type" cannot catch the dead-case failure — it has to assert the actual composed *value* across
pending/confirmed/base layers (`runSettingsWriteStore.test.ts`'s `'plan'`/`'acceptEdits'`/`'default'`
composition test is what pins it). Any future field on `SettingsChange` inherits the same trap.

**Consumer note for a future field, generalized from #1021's `permissionMode`:** `selectEffectiveSettings`
composes a client-owned pending/confirmed value **over a daemon-authored snapshot base**. If the daemon's
read-side vocabulary for a field is ever wider than what the write side accepts back (true today:
`permissionMode`'s snapshot can legitimately be `bypassPermissions`, a value `set_session_settings`
refuses — see [session settings send](session-settings-send.md)), the composed effective value can be one
a submit would be rejected for. A consumer must not offer the currently-displayed value straight back as a
submittable option without filtering it first. #682's permission-mode control is the first place this
applies.

### The data path (`src/renderer/src/store/runSettingsWriteBridge.ts`)

Framework-free, effects injected (the `sessionIdBridge`/`composerSend` idiom), bidirectional:

```ts
translateWriteEvent(event: DaemonEvent): RunSettingsWriteEvent | null
// sessionSettingsUpdated → {settingsConfirmed, changeId}; sessionSettingsRejected → {settingsRejected,
// changeId}; connected → {reconnected} (#539, event.ack ignored — the arm needs no field off it); every
// other arm → null (default fall-through — the translateSessionTransition permanent-ignore idiom, not
// assertNever: this path owns three of the union's arms, two correlated and one connection-lifecycle).

subscribeRunSettingsWrite(onDaemonEvent, dispatch, getOwningServerId?, logReconnect?): () => void
// connected is admitted only for a matching client-bound origin and current unique owner; then each
// event runs through translateWriteEvent and a non-null result is dispatched. Returns the off-handle.
// An admitted reconnect invokes the optional logReconnect callback after dispatch.

submitSettingsChange(deps, change: SettingsChange): void
// deps = { sessionId: string; sendCommand; dispatch; mintChangeId?: () => string }
// (1) mint changeId (default crypto.randomUUID(), injectable — the #236 token-mint DI precedent)
// (2) dispatch({changeDispatched, changeId, change})   — RECORD-BEFORE-SEND
// (3) sendCommand({type: 'setSessionSettings', payload, changeId})
// The SAME changeId on the store record and the command is the correlation invariant. sessionId is
// typed non-null — #257 gates the controls on a present session id (sessionIdStore, #259), so there is
// no null case here to guard.
```

Reconnect admission belongs in `subscribeRunSettingsWrite`, before translation. Its default owner
getter reads the current active conversation and conversation-list stores on each `connected` event,
using `serverIdForOpenConversation` to require exactly one matching, client-stamped row. Ownership is
resolved synchronously at event time, not captured when the app-level subscription mounts. Only a
string-valued client-bound `event.serverId` matching that owner permits cleanup; daemon-reported
`ack.server_id` never authorizes it. No active chat, unloaded/missing/ambiguous ownership, an unstamped
row, or absent/null event origin preserves pending writes. Another host reconnecting therefore leaves
the pending record available for a later correlated confirmation or rejection, including recall writes.
An owning-host reconnect clears pending only, retaining confirmed settings and error state. The app
binding emits only the static `run-settings-write` / `reconnected` diagnostic for an admitted edge.

`translateWriteEvent` alone still translates any `connected` into `reconnected`; testing just that
helper or the reducer cannot prove host isolation. The injected two-host subscription tests in
`runSettingsWriteBridge.test.ts` use the production write and conversation-list stores, change
ownership after subscribing, and supply misleading acknowledgement IDs in both directions. They
assert preservation followed by correlated settlement, owner-only cleanup, and unmatched/replayed
reply no-ops. Confirmation and rejection remain correlation-gated by the reducer, without the reconnect
owner check. See the [reconnect ownership spec](../../specs/architecture/1714-settings-reconnect-owning-host.md).

`buildSettingsPayload(sessionId, change)` builds a **fresh literal** — `session_id` plus the single
changed key — via a per-field `switch`, so the omitempty presence contract (absent key = leave unchanged)
is honored by construction; only the changed field is ever present. This single-key shape is also what
keeps `permission_mode` and `yolo` off one frame (#1021): the daemon refuses a frame carrying both as
malformed, and a `switch` returning one literal per `case` cannot emit both, so nothing has to check for
it. This `switch` is also the one place the store's camelCase `permissionMode` becomes the wire's
snake_case `permission_mode` — the value crosses **verbatim**, no allowlist, no normalisation, no repair,
no mapping onto the `yolo` bit (see [session settings send](session-settings-send.md) for why an allowlist
here would be a false boundary).

### Refusal recovery across navigation

`RunSettingsWriteData` also mounts `subscribeRefusalRecovery`, which observes new
model-write intents and live daemon lifetime events. It updates the existing
conversation timeline's [refusal offer](conversation-timeline-store.md#refusal-offer-lifetime).
Switch back records that offer's correlation before dispatching the ordinary
settings change, so the observer can distinguish recovery from a later manual pick.
Replies match retained offers even after `conversationSwitched` clears this store.
Pending/rejection presentation therefore also reads the conversation-owned offer;
this store's empty pending map is insufficient to enable another recovery write.
Both observer subscriptions are cleaned up with the app-level effect.

### Remembering the confirmed level (#1169)

`runSettingsWriteBridge.ts` folds one more thing into the same event as it dispatches: an effort confirm
also writes the level into [Last-effort store](last-effort-store.md), the renderer preference a newly
opened chat with no effort of its own defaults to (see [Composer effort menu § The default
apply](composer-effort-menu.md#the-default-apply-1169)). This section is that fold, not a new store.

```ts
confirmedEffortLevel(pending: ReadonlyMap<string, SettingsChange>, event: RunSettingsWriteEvent): string | null
// non-null only for a settingsConfirmed whose changeId matches a pending 'effort' record with a
// non-empty value. Everything else — a model/yolo/permissionMode confirm, a rejection, an unmatched
// changeId, reconnected, conversationSwitched — is null.

foldWriteEvent(deps: FoldWriteEventDeps, event: RunSettingsWriteEvent): void
// deps = { getPending, dispatch, rememberEffort, rememberModel?, refresh?, log? }
// resolve the pending match BEFORE dispatch; on success, dispatch → remember → log → refresh.
// A correlated effort rejection dispatches and logs, but neither remembers nor refreshes.
```

**Remember on confirm, not on pick.** A rejected level is not a level that was used, and the confirm is
the *only* seam where the confirmed value is recoverable at all: `sessionSettingsUpdated` carries only
the correlation key (the daemon's ack names no field), and the `settingsConfirmed` arm above deletes the
pending record in the same step it commits — so after the dispatch there is nothing left to read. That is
why `confirmedEffortLevel` takes the pending map as a parameter rather than reading it off the store
itself, and why the read **must precede** the dispatch: reading after would find an already-emptied map
and remember nothing, silently — a change that dispatches the same events the same number of times,
passes every count assertion, and never persists anything. `foldWriteEvent`'s ordering is pinned by a
named test asserting `getPending` was called before `dispatch`.

After remembering a correlated effort success, the app-level binding requests settings for the
conversation active at invocation. Passive readings, unmatched/replayed replies and rejected choices
cannot refresh or persist through this path. Diagnostics carry only the static `composer-effort`
event and `confirmed`/`rejected` codes. A confirmation before Claude starts may persist the choice
while the footer still has no applied reading.

The no-match arm reuses this store's own fail-closed rule rather than restating it: an uncorrelated
confirm commits nothing in the reducer, so it remembers nothing here either — which is also what closes a
confirm **replayed** by the content-blind relay, since the second copy matches no pending record.

**Why this is not a loop, twice over.** Applying a remembered level is itself an ordinary change that
confirms and re-remembers the same value — idempotent, not a self-reinforcing write. And the *harder*
hazard this closes is a genuine self-inflicted write loop: the obvious no-retry guard for "apply the
remembered level to a chat reporting none" is this store's own `error` field, and it is wrong, because
`changeDispatched` clears `error` on every fresh attempt — so an operator picking a *model* after the
default effort was refused would clear the guard while the chat's effort is still `''`, and the refused
level would go out again, once per unrelated setting change thereafter. [#1169](../codebase/1169.md)'s
security review caught this; the shipped guard lives in the *reader* instead
(`EffortDefaultData`'s own `appliedFor` marker, nothing on this write path can clear it) rather than here,
because nothing added to this reducer could distinguish "refused, don't retry" from "confirmed, now
stale" without becoming per-field state this store has no other reason to hold.

### Remembering the confirmed model

`foldWriteEvent` also captures a correlated pending model change before dispatch consumes
it. After dispatch, a non-empty value without `source: 'recall'` calls `rememberModel`,
wired by `RunSettingsWriteData` to the profile-wide [remembered-model preference](remembered-model.md).
Dropdown and Run configuration picks share this seam. Pending, rejected, passive,
unmatched and replayed events never persist. Automatic recall confirms the chat's choice
but cannot overwrite a newer deliberate preference, unlike effort's re-remembering rule.
The optional source is renderer metadata; `buildSettingsPayload` still sends only the
session ID and raw model value. Preference diagnostics contain only static codes.

Recall regressions must use the production subscription, fold and reducer together:
an unrelated host's reconnect must preserve the pending record so a later owning-host
confirmation both commits the effective selection and releases sending. Background
build/send failures arrive as asynchronous correlated rejection events; command return
alone proves no settlement. See [the boundary tests](remembered-model.md#testing).

### The React binding — `RunSettingsWriteData` (same file)

A headless leaf (`RunSettingsWriteData(): null`) mounted **unconditionally at App level**
(`src/renderer/src/App.tsx`), alongside `<ConversationListData />` and `<SessionIdData />` — not
sheet-scoped. A confirm/reject reply can arrive **after** the Run config sheet closes, so the listener
must outlive the sheet; a sheet-scoped subscription would strand the pending marker. That same rationale
now covers the `reconnected` clear ([#539](../codebase/539.md)) for free — the edge fires whether or not
the sheet is open. The settings subscription passes translated events through `foldWriteEvent`,
wiring this store's dispatch, last-effort and remembered-model persistence, active-conversation refresh and content-free
diagnostics. `getState()`
is read **per event**, never captured at subscription, because this listener is app-lifetime: a `pending`
snapshot taken at mount would freeze at whatever was in flight when App mounted. `window.pyry` is
dereferenced only inside the effect (the `SessionIdData` server-render invariant). The returned off-handle
is the effect cleanup, so a StrictMode double-mount nets exactly one live listener.

### Data flow

```
\#257 control → submitSettingsChange(deps, change)
                 ├─ dispatch({changeDispatched, changeId, change})  → pending + optimistic view
                 └─ sendCommand({setSessionSettings, payload, changeId}) → main (#263) → daemon
daemon reply → main correlates by Envelope.in_reply_to (#261/#269) → emits:
   sessionSettingsUpdated{sessionId, changeId}  ─┐
   sessionSettingsRejected{changeId}            ─┤
RunSettingsWriteData (App-level) → subscribeRunSettingsWrite → translateWriteEvent
   → dispatch({settingsConfirmed|settingsRejected, changeId}) → commit / roll back + error
\#257 reads: selectEffectiveSettings(runConfigStore snapshot, write state) + selectError + selectPendingFields
```

## Configuration and usage

- **Import surface**, consumed by `RunConfigSections` (#257):
  `import { useRunSettingsWriteStore, selectEffectiveSettings, selectError, selectPendingFields } from '@renderer/store/runSettingsWriteStore'`
  and `import { submitSettingsChange } from '@renderer/store/runSettingsWriteBridge'` (the latter via
  #257's `runSettingsControls.ts` gate, `changeSetting`).
- **Mount point:** `src/renderer/src/App.tsx`, `<RunSettingsWriteData />` alongside
  `<ConversationListData />` and `<SessionIdData />`.
- **`selectEffectiveSettings` composes across two stores** — this store's pending/confirmed state and
  `runConfigStore`'s snapshot base — but the composition call itself is #257's responsibility (the
  container's render body), kept out of the store to avoid a cross-store import here. #257's container
  selects the **raw** write state (`(s) => s`) rather than `selectEffectiveSettings` as the zustand
  selector, since the latter returns a fresh object per call and would defeat `Object.is`.

## Scoped to the open chat since #1167

Before #1167 the durable half of this store had no lifetime at all: `set_session_settings`'s ack carries
only `session_id`, never rewrites the snapshot, so a `confirmed` override made in one chat composed over
*every later chat's* snapshot permanently — no reply could ever displace it, unlike the sibling
[Run configuration store](run-config-store.md)'s snapshot, which #1166/#1176 already bound to one round
trip. `clearPairingScopedState` left this store alone entirely (it never reached it), and neither
`activateConversation` nor `exitActiveConversation` cleared it either — the write half was the durable
defect the ticket names.

`PairedShell`'s `clearRunConfig` dep member dispatches `{ type: 'conversationSwitched' }` on this store
in the same call that clears `runConfigStore`'s snapshot — see [Run configuration store § Scoped to the
open chat since \#1167](run-config-store.md#scoped-to-the-open-chat-since-1167) and [Paired shell —
conversation exits and stamps § The run-configuration
clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167)
for the placement in each helper. One member fires both clears because they are one act ("this chat's run
configuration is no longer the one to show"): they always fire together and neither is sufficient alone —
clearing only `runConfigStore` would leave a confirmed override standing over the newly opened chat's
snapshot, and clearing only this store would leave the previous chat's raw snapshot displayed until a
reply arrived.

## Edge cases and limitations

- **A change stranded by a reconnect no longer strands forever** ([#539](../codebase/539.md)) — the
  `reconnected` arm clears `pending` on an admitted owning-host `connected` (re)handshake, so a dropped
  send or daemon silence across that host's reconnect resolves at the next admitted connect rather than
  shadowing a later confirmed change permanently. Unknown ownership preserves pending until an
  attributable reconnect, correlated reply or conversation switch. Two residuals remain, both accepted
  rather than engineered around: (1) the sheet still shows the optimistic never-applied value for the
  duration of the outage itself, since the clear fires
  on reconnect, not on the drop (`disconnected` is never emitted anywhere in `src/main`); (2) a change
  dispatched in the single IPC hop between main emitting the owning host's `connected` and the renderer
  receiving it is really sent and really correlated, and gets cleared anyway — its later confirm arrives as a no-match
  no-op, so it never commits. Closing residual 2 would need per-change generation correlation across the
  IPC boundary, out of proportion to the defect. A stale reply for a change that stays connected the whole
  time (no reconnect involved) is still unresolved forever — that failure mode remains genuinely
  unobserved and out of scope.
- **Confirmation order, not dispatch order, wins for two outstanding same-field changes.** If change A
  dispatches before change B (same field) but B's confirm arrives first, `confirmed` lands B's value,
  then A's confirm (when it eventually arrives) overwrites it with A's — the *later*-confirmed value
  wins, which can be the *earlier*-dispatched one. Benign under the single-client, sequential-daemon-reply
  model this app runs under (code review NIT on [#256](../codebase/256.md), non-blocking, no AC violated).
- **`error` persists until the next `changeDispatched`.** A `settingsConfirmed` leaves `error` untouched,
  so a stale rejection error can briefly outlive a later, unrelated success — #257 does not clear it on
  its own signal either; the AC only requires a retry (which does dispatch) to clear it.
- **No reset when a fresh snapshot arrives for the same chat.** Confirmed explicit-choice overrides
  remain available to the sheet and recall policy. They never override the footer's applied effort,
  which may differ from the saved choice. A conversation switch clears the entire write state;
  see § Scoped to the open chat since #1167 above.

## Related

- [Session settings send](session-settings-send.md) — the outbound `setSessionSettings` command this
  store's bridge sends, and the two correlated daemon events (`sessionSettingsUpdated`/
  `sessionSettingsRejected`, #261/#269) it consumes.
- [Session-id store](session-id-store.md) — the direct structural precedent (App-level always-listening
  headless leaf) and the source of `submitSettingsChange`'s `sessionId`, wired together by #257.
- [Run configuration store](run-config-store.md) — the daemon-live snapshot this store's
  `selectEffectiveSettings` composes *over*; deliberately not folded into as a facet.
- [Daemon-event bridge](daemon-event-bridge.md) — the three existing bridges whose
  `sessionSettingsUpdated`/`sessionSettingsRejected` no-op arms this store's independent, fourth
  App-level subscriber sits beside without modifying.
- [Conversation shell](conversation-shell.md) — the Run configuration sheet #257 wired this store's
  selectors and `submitSettingsChange` into.
- [#558 codebase notes](../codebase/558.md) — `selectPendingFields`'s first production consumer: renders
  each field's in-flight flag as `aria-busy` on the control it targets, so an unconfirmed change stops
  rendering identically to a settled one.
- [#257 codebase notes](../codebase/257.md) — the interactive controls consuming this store: the
  container reads raw write state + composes `selectEffectiveSettings`/`selectError` in the render body,
  and `runSettingsControls.ts`'s `changeSetting` gates `submitSettingsChange` on a known session id.
- [#256 codebase notes](../codebase/256.md) — implementation summary, patterns established, lessons
  learned, and the code-review NIT on same-field confirm ordering.
- [#261 codebase notes](../codebase/261.md) / [#269 codebase notes](../codebase/269.md) — the confirmed/
  rejected correlation halves this store's `translateWriteEvent` consumes.
- [#263 codebase notes](../codebase/263.md) — the outbound command + connection method this store's
  `submitSettingsChange` sends.
- [#259 codebase notes](../codebase/259.md) — the structural precedent for an App-level always-listening
  holder, extended here from a single setter to a three-arm reducer.
- **#1021** — added `permissionMode` as `SettingsChange`'s fourth arm: the wire/guard/builder half in
  [session settings send](session-settings-send.md), and here the union arm, `applyConfirmed`, both
  hand-widened selector return types (the compiler-forces-a-`case`-not-a-field trap, § above), and
  `buildSettingsPayload`'s camelCase→snake_case translation. No consumer is built by this ticket; the
  control that submits a mode is #682. Split from #682.
- [#539 codebase notes](../codebase/539.md) — the `reconnected` arm: clears every stranded `pending`
  entry on an admitted owning-host `connected` (re)handshake edge, preserving `confirmed`/`error`, so a
  change abandoned by main's re-dial correlation reset can no longer shadow a later confirmed change. Split from
  [#509](https://github.com/pyrycode/pyrycode-desktop/issues/509); sibling of
  [#538 codebase notes](../codebase/538.md) ([thread timeline](conversation-timeline-store.md)'s twin
  arm), [#415](../codebase/415.md) (`modalStore`'s), and [#197](../codebase/197.md) (`queueStore`'s) —
  these stores consume the connection edge, with this write bridge applying the owner check described
  above.
- **[#1169](../codebase/1169.md)** — added `confirmedEffortLevel`/`foldWriteEvent`: an effort confirm
  also writes the level into [Last-effort store](last-effort-store.md), read back by
  [Composer effort menu § The default apply](composer-effort-menu.md#the-default-apply-1169) to default a
  newly opened conversation's explicit choice when empty. No reducer arm changed. See §
  Remembering the confirmed level above.
- **[#1167](https://github.com/pyrycode/pyrycode-desktop/issues/1167)** — added `conversationSwitched`,
  the deliberate contrast arm to `reconnected`: it clears `confirmed` and `error` too, because a switch
  changes which session is being described rather than merely abandoning correlations for the one still
  open. Dispatched by `activateConversation`/`exitActiveConversation` through the same `clearRunConfig`
  dep member that clears [Run configuration store](run-config-store.md#scoped-to-the-open-chat-since-1167)'s
  snapshot. See § Scoped to the open chat since #1167 above.
