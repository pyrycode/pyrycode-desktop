# Run configuration write store

The renderer's **pending-write state machine** for a Model / Effort / YOLO change: it holds a requested
change optimistically, then settles it to the daemon's confirmed result or rolls it back on rejection —
the state the interactive Run configuration controls ([#257](../codebase/257.md)) dispatch onto and read
back.

Introduced in [#256](../codebase/256.md), the last store-machine slice of #183's interactive
Run-configuration write path before the render consumer [#257](../codebase/257.md) (since shipped, PR
#283). Consumes the two correlated daemon events [#261](../codebase/261.md) (`sessionSettingsUpdated`)
and [#269](../codebase/269.md) (`sessionSettingsRejected`), and drives the outbound
[session settings send](session-settings-send.md) (#263) command. This store itself delivers no visible
surface of its own — #257 is now its live consumer, the same posture `sessionIdStore` (#259) had before
#257 and `runConfigStore` (#187) had before #188.

## What it does

Lets a caller dispatch a per-field settings change (`{field: 'model'|'effort'|'yolo', value}`), reflects
it immediately in the store's derived view, and resolves it — commit or roll back — when the matching
correlated daemon reply arrives. A confirm/reject whose correlation id matches no pending change is a
fail-closed no-op: it never commits or rolls back the wrong change, and two outstanding changes are told
apart by their own correlation ids.

## How it works

### The problem this store solves

`set_session_settings`'s reply carries only `session_id` — no settings — and the change applies on the
**next session spawn** (daemon ADR 031), so `runConfigStore.snapshot` (the daemon's *live-session* value)
does not change on an ack. The sheet cannot re-read the new value from the daemon; it has to remember what
it asked for and trust the daemon's ack/error as the verdict. This store is that memory.

### The store (`src/renderer/src/store/runSettingsWriteStore.ts`)

```ts
export type SettingsChange =
  | { field: 'model'; value: string }
  | { field: 'effort'; value: string }
  | { field: 'yolo'; value: boolean }

export type RunSettingsWriteEvent =
  | { type: 'changeDispatched'; changeId: string; change: SettingsChange }
  | { type: 'settingsConfirmed'; changeId: string }   // from sessionSettingsUpdated (#261)
  | { type: 'settingsRejected'; changeId: string }    // from sessionSettingsRejected (#269)
  | { type: 'reconnected' }                           // from the connected wire edge ([#539](../codebase/539.md))

export interface RunSettingsWriteState {
  pending: ReadonlyMap<string, SettingsChange>                    // changeId → requested change
  confirmed: { model?: string; effort?: string; yolo?: boolean }  // sparse client-confirmed overrides
  error: SettingsChange['field'] | null                           // last-rejected field, or null
}

createRunSettingsWriteStore(init?)   // vanilla createStore — one isolated instance per test (DI seam)
runSettingsWriteStore                // app-wide singleton
useRunSettingsWriteStore(selector)   // React binding: useStore(runSettingsWriteStore, selector)
```

An **adjacent, dedicated store** — not a `runConfigStore` facet — for the same two reasons as
[`sessionIdStore`](session-id-store.md) (#259): (a) its inbound subscription must be **App-level
always-listening** (a confirm/reject reply can arrive after the sheet closes, whereas `runConfigStore`'s
subscriber is sheet-scoped); (b) its state (pending changes + client-confirmed overrides + last error) is
orthogonal to the snapshot's `{model, effort, yolo, usedTokens, windowTokens}` shape. Unlike
`sessionIdStore`'s named setters, this is a **reducer** (`dispatch` over the sealed event union) because
every one of its four transitions reads prior state: three (dispatch / confirm / reject) are
**correlated** — a confirm or reject is a no-op without a matching pending record — and the fourth,
`reconnected` ([#539](../codebase/539.md)), is uncorrelated (no `changeId`) but still prior-state-reading,
since it clears only when something is pending. `sessionIdStore`'s set and clear
([#529](../codebase/529.md)) are independent whole-value writes that read nothing. The contrast is the
coupling, not the count.

### The reducer (four arms, each pinned by a named test)

- **`changeDispatched`** — `pending.set(changeId, change)`; clears `error` (a fresh attempt supersedes
  the last rejection). `confirmed` untouched — the optimistic value shows only through the pending
  overlay in `selectEffectiveSettings`.
- **`settingsConfirmed`** — looks up `pending.get(changeId)`; if absent, **no-op** (fail-closed); else
  commits **the value the client sent** (the event itself carries none) into `confirmed` and deletes the
  pending marker.
- **`settingsRejected`** — looks up `pending.get(changeId)`; if absent, **no-op** (fail-closed); else
  deletes the pending marker (the view rolls back on its own — the optimistic overlay vanishes, revealing
  the last confirmed value or the snapshot base) and sets `error` to the rejected field.
- **`reconnected`** ([#539](../codebase/539.md)) — drops **every** pending marker, regardless of how many
  were outstanding, because main abandons its envelope-id → `changeId` correlation on each re-dial
  (`daemonConnection.ts` `dial()`) and emits no rejection in its place, so a change stranded by a
  reconnect can never resolve on its own — and since `pending` beats `confirmed` in
  `selectEffectiveSettings`, an unresolved stranded entry would otherwise outlive (and shadow) a later
  *confirmed* change on the same field forever. `confirmed` and `error` are left untouched: a standing
  rejection is still true after a reconnect, and a confirmed override is still what the daemon has. Same-
  reference no-op when `pending` is already empty — load-bearing, not cosmetic, because #257's container
  selects the **whole raw state** (`RunConfigSections.tsx:327`) as its zustand selector, so this is what
  keeps a reconnect with nothing in flight from re-rendering the sheet.

There is no explicit "roll back" mutation: **clearing the pending marker *is* the rollback**, because the
effective view falls through to the confirmed override or the snapshot base — `reconnected` is a fourth
caller of that doctrine, not a new mechanism. A no-match (or already-clear) arm returns the same state
object, so zustand skips the notify.

### The effective-view derivation

```ts
function selectEffectiveSettings(
  snapshot: RunConfigSnapshot | null,
  s: RunSettingsWriteState
): Pick<RunConfigSnapshot, 'model' | 'effort' | 'yolo'>
```

Composes the displayed value per field, precedence high to low:

1. the **last-inserted** `pending` entry for that field, if any (optimistic; `Map` insertion order gives
   last-write-wins for rapid same-field changes);
2. else `confirmed[field]`, if set;
3. else the snapshot base (`snapshot?.model ?? ''`, `?? ''`, `?? false`).

`??` falls through only on `undefined`, so an empty-string / `false` value at any layer is held verbatim
— never coerced (the `runConfigStore` no-coercion posture). `selectError(s)` and
`selectPendingFields(s): {model; effort; yolo}` (booleans) round out the read surface for the sheet's
in-flight UI state — `selectPendingFields` shipped with #256 but had no production consumer until
[#558](../codebase/558.md) rendered it as `aria-busy` on the owning control.

### The data path (`src/renderer/src/store/runSettingsWriteBridge.ts`)

Framework-free, effects injected (the `sessionIdBridge`/`composerSend` idiom), bidirectional:

```ts
translateWriteEvent(event: DaemonEvent): RunSettingsWriteEvent | null
// sessionSettingsUpdated → {settingsConfirmed, changeId}; sessionSettingsRejected → {settingsRejected,
// changeId}; connected → {reconnected} (#539, event.ack ignored — the arm needs no field off it); every
// other arm → null (default fall-through — the translateSessionTransition permanent-ignore idiom, not
// assertNever: this path owns three of the union's arms, two correlated and one connection-lifecycle).

subscribeRunSettingsWrite(onDaemonEvent, dispatch): () => void
// each event runs through translateWriteEvent; a non-null result is dispatched. Returns the off-handle
// (the daemonEventBridge cleanup idiom).

submitSettingsChange(deps, change: SettingsChange): void
// deps = { sessionId: string; sendCommand; dispatch; mintChangeId?: () => string }
// (1) mint changeId (default crypto.randomUUID(), injectable — the #236 token-mint DI precedent)
// (2) dispatch({changeDispatched, changeId, change})   — RECORD-BEFORE-SEND
// (3) sendCommand({type: 'setSessionSettings', payload, changeId})
// The SAME changeId on the store record and the command is the correlation invariant. sessionId is
// typed non-null — #257 gates the controls on a present session id (sessionIdStore, #259), so there is
// no null case here to guard.
```

`buildSettingsPayload(sessionId, change)` builds a **fresh literal** — `session_id` plus the single
changed key — via a per-field `switch`, so the omitempty presence contract (absent key = leave unchanged)
is honored by construction; only the changed field is ever present.

### The React binding — `RunSettingsWriteData` (same file)

A headless leaf (`RunSettingsWriteData(): null`) mounted **unconditionally at App level**
(`src/renderer/src/App.tsx`), alongside `<ConversationListData />` and `<SessionIdData />` — not
sheet-scoped. A confirm/reject reply can arrive **after** the Run config sheet closes, so the listener
must outlive the sheet; a sheet-scoped subscription would strand the pending marker. That same rationale
now covers the `reconnected` clear ([#539](../codebase/539.md)) for free — the edge fires whether or not
the sheet is open. One
`useEffect(() => subscribeRunSettingsWrite(window.pyry.onDaemonEvent, e => runSettingsWriteStore.getState().dispatch(e)), [])`;
`window.pyry` is dereferenced only inside the effect (the `SessionIdData` server-render invariant). The
returned off-handle is the effect cleanup, so a StrictMode double-mount nets exactly one live listener.

### Data flow

```
#257 control → submitSettingsChange(deps, change)
                 ├─ dispatch({changeDispatched, changeId, change})  → pending + optimistic view
                 └─ sendCommand({setSessionSettings, payload, changeId}) → main (#263) → daemon
daemon reply → main correlates by Envelope.in_reply_to (#261/#269) → emits:
   sessionSettingsUpdated{sessionId, changeId}  ─┐
   sessionSettingsRejected{changeId}            ─┤
RunSettingsWriteData (App-level) → subscribeRunSettingsWrite → translateWriteEvent
   → dispatch({settingsConfirmed|settingsRejected, changeId}) → commit / roll back + error
#257 reads: selectEffectiveSettings(runConfigStore snapshot, write state) + selectError + selectPendingFields
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

## Edge cases and limitations

- **A change stranded by a reconnect no longer strands forever** ([#539](../codebase/539.md)) — the
  `reconnected` arm clears `pending` on every `connected` (re)handshake, so a dropped send or daemon
  silence across a reconnect resolves at the next connect rather than shadowing a later confirmed change
  permanently. Two residuals remain, both accepted rather than engineered around: (1) the sheet still
  shows the optimistic never-applied value for the duration of the outage itself, since the clear fires
  on reconnect, not on the drop (`disconnected` is never emitted anywhere in `src/main`); (2) a change
  dispatched in the single IPC hop between main emitting `connected` and the renderer receiving it is
  really sent and really correlated, and gets cleared anyway — its later confirm arrives as a no-match
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
- **No reset when a fresh snapshot arrives.** A `confirmed` override that matches the next spawn's
  snapshot becomes redundant but harmless (`override === snapshot`); no divergence occurs in the
  single-client model. Deferred — add clearing only if a real divergence surfaces.

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
- [#539 codebase notes](../codebase/539.md) — the `reconnected` arm: clears every stranded `pending`
  entry on the `connected` (re)handshake edge, preserving `confirmed`/`error`, so a change abandoned by
  main's re-dial correlation reset can no longer shadow a later confirmed change. Split from
  [#509](https://github.com/pyrycode/pyrycode-desktop/issues/509); sibling of
  [#538 codebase notes](../codebase/538.md) ([thread timeline](conversation-timeline-store.md)'s twin
  arm), [#415](../codebase/415.md) (`modalStore`'s), and [#197](../codebase/197.md) (`queueStore`'s) —
  four stores now reconcile on the same edge.
