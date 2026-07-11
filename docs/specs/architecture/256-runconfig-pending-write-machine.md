# Spec #256 — Run configuration pending write machine (optimistic → confirm/reject)

**Ticket:** #256 — hold pending Model/Effort/YOLO changes and resolve on confirm/reject
**Size:** S (upper edge; store + its data path, the #259 single-ticket template)
**Depends on (merged):** #261 (`sessionSettingsUpdated`), #269 (`sessionSettingsRejected`), #263 (`setSessionSettings` command), #259 (`sessionIdStore`).
**Consumer (not this ticket):** #257 — the interactive controls that dispatch onto and read back this store.

---

## Files to read first

- `src/renderer/src/store/sessionIdStore.ts` — **the direct structural template.** App-singleton store via DI-factory → singleton → hook → selector. The write store mirrors this shape, but is **reducer-style** (a sealed event union + one `dispatch`) rather than single-setter, because it has three real transitions (dispatch/confirm/reject). Also note the doc-comment rationale for *why an adjacent dedicated store, not a `runConfigStore` facet* — the same two reasons apply here (App-level always-listening + orthogonal to the snapshot).
- `src/renderer/src/store/sessionIdBridge.ts` — **the direct data-path template.** `translateSessionTransition` (a `default: null` filter), `subscribeSessionId` (off-handle cleanup, `id !== null` guard), and `SessionIdData` (headless, App-level, `window.pyry` dereferenced only inside the effect). This ticket's inbound bridge is the same shape; the file additionally carries the *outbound* submit helper.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` — the injected-effects data-path idiom (React-free `translate` + `subscribe` helpers, testable with plain spies). Extract the shape, not the content.
- `src/renderer/src/store/runConfigStore.ts:26-70` — `RunConfigSnapshot` (the base the write machine composes **over**) and the single-setter store the write machine does **not** fold into. Note `snapshot: null` = "not loaded", and empty-string / `yolo:false` held verbatim (never coerced) — the write machine preserves the same no-coercion posture.
- `src/renderer/src/store/runConfigStore.test.ts` — the plain-function, isolated-`createStore()`-per-test idiom (no React); the write store's reducer tests follow it exactly.
- `src/shared/ipc/events.ts:104-116` — the two consumed arms: `sessionSettingsUpdated { sessionId; changeId }` (commit) and `sessionSettingsRejected { changeId }` (rollback). Read the doc comments: `changeId` is the renderer-minted correlation key; `sessionSettingsRejected` deliberately carries **no** error code/message/`sessionId`. This ticket is the **fourth** consumer of the daemon-event channel; it does **not** modify the three existing bridges' no-ops (the #259 precedent — a new App-level listener, not an edit to the others).
- `src/shared/ipc/commands.ts:68-76` and `:133-141` — the `setSessionSettings` command shape (`{ type; payload; changeId }`, `changeId` a **top-level sibling** of `payload`, never on the wire) and its boundary guard. The outbound submit helper builds exactly this command.
- `src/shared/wire/types.ts:135-157` — `SetSessionSettingsPayload` (`session_id` + optional `model`/`effort`/`yolo`, omitempty presence contract). The submit helper builds a payload with `session_id` + the **single** changed field.
- `src/renderer/src/App.tsx:94-104` — the App-level headless-leaf mount site (`ConversationListData` / `SessionIdData`). Add `<RunSettingsWriteData />` here as a sibling.
- `src/renderer/src/screens/conversation/composerSend.ts` — the injected fire-and-forget `sendCommand` outbound idiom (`void`, nothing to await). The submit helper mirrors it.

## Design source

N/A — store machine only; this ticket delivers the state the interactive controls dispatch onto and read back. All visible surface lands in the render slice **#257**, which owns its own Figma anchor. The visual-fidelity check is intentionally not applicable here.

---

## Context

The Run configuration sheet holds the session's live model / effort / YOLO snapshot (`runConfigStore`, #187) and renders it read-only (#188). Making it *writable* needs a state machine because the daemon's `set_session_settings` reply **does not echo the applied settings** and the change lands on the *next* session spawn (daemon ADR 031: live-restart is fire-and-forget). So the sheet cannot re-read the new value from the daemon — it must (a) reflect the requested value **optimistically**, then (b) **commit** it on the confirmed event or **roll it back** on the rejected event.

Both events already landed in the transport, correlated by the renderer-minted `changeId`: `sessionSettingsUpdated { sessionId; changeId }` (#261) and `sessionSettingsRejected { changeId }` (#269). Both are currently no-op'd in every renderer bridge, waiting for this consumer. The outbound `setSessionSettings` command (#263) already ships over the generic command channel and carries a `changeId` sibling. This slice adds the store machine that mints one `changeId` for both the outbound command and the pending record, so the confirm/reject matches.

---

## Design

### Ownership decision (the ticket's key question)

`runConfigStore.snapshot` is the daemon's **live-session** value; it does not change on an ack. The confirmed display after a successful change is therefore a **client-side** value that diverges from the daemon snapshot until the next spawn. So:

- **An adjacent dedicated store** (`runSettingsWriteStore`), *not* a `runConfigStore` facet — the same two reasons as #259's `sessionIdStore`: (a) its inbound subscription must be **App-level always-listening** (a confirm/reject reply can arrive after the sheet closes), whereas `runConfigStore`'s subscriber is sheet-scoped; (b) the write state (pending changes + client-confirmed overrides + error) is orthogonal to the snapshot's `{ model, effort, yolo, usedTokens, windowTokens }`.
- The write store holds **sparse per-field confirmed overrides**, composed *over* the snapshot base — never a duplicated full triple. This is what avoids the divergence hazard the ticket flags: the snapshot stays the daemon's, the override is the client's, and the effective display layers them.

### Module structure

Two new files + one mount line:

1. `src/renderer/src/store/runSettingsWriteStore.ts` — pure renderer state (no IPC): the state type, the sealed event union, the reducer, DI-factory → singleton → hook → selectors, and the pure `selectEffectiveSettings` derivation.
2. `src/renderer/src/store/runSettingsWriteBridge.ts` — the data path (React-free helpers + one headless component): the inbound `translateWriteEvent` filter, `subscribeRunSettingsWrite`, the outbound `submitSettingsChange` helper, and the App-level `RunSettingsWriteData` component.
3. `src/renderer/src/App.tsx` — mount `<RunSettingsWriteData />` alongside `SessionIdData` (+1 import, +1 JSX line).

### Key types (contracts — the developer writes the bodies)

```typescript
// The per-field intent the user requests. Discriminated on `field` so `value` is exact per field.
type SettingsChange =
  | { field: 'model'; value: string }
  | { field: 'effort'; value: string }
  | { field: 'yolo'; value: boolean }

// The store's sealed event set (outgoing user action + the two incoming daemon events), on `type`.
type RunSettingsWriteEvent =
  | { type: 'changeDispatched'; changeId: string; change: SettingsChange }
  | { type: 'settingsConfirmed'; changeId: string }  // from sessionSettingsUpdated (#261)
  | { type: 'settingsRejected'; changeId: string }    // from sessionSettingsRejected (#269)

interface RunSettingsWriteState {
  pending: ReadonlyMap<string, SettingsChange>          // changeId → requested change, unresolved
  confirmed: { model?: string; effort?: string; yolo?: boolean }  // sparse client-confirmed overrides
  error: SettingsChange['field'] | null                 // last rejected field; null when none
}

type RunSettingsWriteStore = RunSettingsWriteState & {
  dispatch: (event: RunSettingsWriteEvent) => void      // the reducer entry point (sessionStore idiom)
}
```

- `pending` is a `Map` (insertion-ordered) so two outstanding changes are told apart by `changeId` (AC4) and same-field ordering is deterministic. Expose it as `ReadonlyMap` through selectors.
- `error` carries only the **field** — `sessionSettingsRejected` deliberately carries no daemon message (#269), so the store cannot surface daemon text; #257 renders the copy from the field. This is the belt-and-suspenders "different fabric": the security decision to strip the daemon message lives in the transport, and this store never reconstitutes it.

### Reducer behavior (three arms; each invariant pinned by a named test)

- **`changeDispatched`** — `pending.set(changeId, change)`; `error = null` (a fresh attempt supersedes the last rejection). Does **not** touch `confirmed`. *(AC1: pending recorded, view optimistically reflects the requested value; last confirmed left unchanged.)*
- **`settingsConfirmed`** — `p = pending.get(changeId)`; if `undefined` → **no-op** (AC4 fail-closed); else `confirmed[p.field] = p.value` (commit **the value the client sent** — the event carries none) and `pending.delete(changeId)`. `error` untouched. *(AC2.)*
- **`settingsRejected`** — `p = pending.get(changeId)`; if `undefined` → **no-op** (AC4 fail-closed); else `pending.delete(changeId)` (the view rolls back on its own — the optimistic overlay vanishes, revealing the last confirmed value) and `error = p.field`. `confirmed` untouched. *(AC3: no optimistic value survives a failure.)*

There is no explicit "roll back" mutation: clearing the pending marker *is* the rollback, because the effective view falls through to the confirmed override or the snapshot base. Commit works the same way in reverse — promoting the value into `confirmed` before deleting the marker keeps the view showing it.

### The effective-view derivation (the "read back" surface, AC1/AC5)

```typescript
// Compose the displayed settings per field: optimistic pending overlay > client-confirmed override >
// snapshot base. Pure — #257 reads it and this ticket's tests assert it directly, with no render.
function selectEffectiveSettings(
  snapshot: RunConfigSnapshot | null,
  s: RunSettingsWriteState
): Pick<RunConfigSnapshot, 'model' | 'effort' | 'yolo'>
```

Per field, precedence:
1. the value of the **last-inserted** `pending` entry for that field, if any (optimistic; `Map` order gives last-write-wins for rapid same-field changes);
2. else `confirmed[field]`, if set;
3. else the snapshot base (`snapshot?.model ?? ''`, `?? ''`, `?? false`) — empty-string / `false` held verbatim, never coerced (the `runConfigStore` posture).

Also expose thin selectors for #257: `selectError(s)` and a per-field pending-flag selector (`{ model: boolean; effort: boolean; yolo: boolean }`) so the controls can show an in-flight state and disable during a pending change. `EffectiveRunSettings` is expressed as `Pick<RunConfigSnapshot, …>` — no new named type.

### The data path (`runSettingsWriteBridge.ts`)

- **Inbound filter** — `translateWriteEvent(event: DaemonEvent): RunSettingsWriteEvent | null`: `sessionSettingsUpdated` → `{ type: 'settingsConfirmed', changeId: event.changeId }`; `sessionSettingsRejected` → `{ type: 'settingsRejected', changeId: event.changeId }`; every other arm → `null` via `default: null` (permanent ignore — the `translateSessionTransition` idiom, not `assertNever`).
- **Inbound subscribe** — `subscribeRunSettingsWrite(onDaemonEvent, dispatch): () => void`: subscribe; each event runs through `translateWriteEvent`; a non-null result is passed to `dispatch`. Returns the off-handle (effect-cleanup idiom).
- **Outbound submit** — `submitSettingsChange(deps, change: SettingsChange): void` where `deps = { sessionId: string; sendCommand; dispatch; mintChangeId?: () => string }`. It (1) mints `changeId` (default `crypto.randomUUID()`, injectable per the #236 token-mint DI precedent); (2) `dispatch({ type: 'changeDispatched', changeId, change })` — **record-before-send**; (3) `sendCommand({ type: 'setSessionSettings', payload, changeId })`. The **same** `changeId` on the store record and the command is the correlation invariant (pinned by a test). `sessionId` is typed non-null: #257 gates the controls on a present session id (`sessionIdStore`, #259), so there is no null case to guard — the type enforces it.
  - The payload is a **fresh literal** with `session_id` plus the single changed key, built via a `switch (change.field)` (each arm narrows `value` to the right type). Only the changed field is present — the omitempty presence contract is honored by construction, and the main-side builder (#263) drops anything else.
- **App-level component** — `RunSettingsWriteData(): null`: one `useEffect` on mount that calls `subscribeRunSettingsWrite(window.pyry.onDaemonEvent, (e) => runSettingsWriteStore.getState().dispatch(e))` and returns the off-handle as cleanup. Renders `null`. `window.pyry` dereferenced only inside the effect (server-renders to `''` without a bridge mock — the `SessionIdData` invariant). Mounted in `App.tsx` alongside `SessionIdData`.

### Data flow

```
#257 control → submitSettingsChange(deps, change)
                 ├─ dispatch({changeDispatched, changeId, change})  → pending + optimistic view
                 └─ sendCommand({setSessionSettings, payload, changeId}) → main (#263) → daemon
daemon reply → main correlates by Envelope.in_reply_to (#261) → emits over daemon-event channel:
   sessionSettingsUpdated{sessionId, changeId}  ─┐
   sessionSettingsRejected{changeId}            ─┤
RunSettingsWriteData (App-level) → subscribeRunSettingsWrite → translateWriteEvent
   → dispatch({settingsConfirmed|settingsRejected, changeId}) → commit / roll back + error
#257 reads: selectEffectiveSettings(runConfigStore snapshot, write state) + selectError + pending flags
```

### Re-render seams

- `runSettingsWriteStore` is an app-singleton read via `useRunSettingsWriteStore(selector)` with **narrow** selectors (the effective value, the error, the pending flags) so #257 re-renders only on the slice it selects.
- The effective value depends on **both** stores; #257 composes them (reads `useRunConfigStore(selectSnapshot)` + the write-store slices and calls `selectEffectiveSettings`). This ticket provides the pure function; #257 wires the hook — keeping the composition out of the store.
- `RunSettingsWriteData` renders `null` and isolates its subscription in its own leaf, so daemon events never cascade a re-render into `App` (the `SessionIdData` / `ConversationListData` invariant).

---

## State + concurrency model

- **Single source of state:** one Zustand store (`runSettingsWriteStore`); UI reads `(state, dispatch)` and never two-way-binds. All mutation flows through the reducer's sealed event union — no parallel mutable state elsewhere (AC5).
- **Lifecycle — App-level, always-listening (the #259 lesson):** the inbound subscription mounts in `App.tsx` (app-lifetime), **not** in `RunConfigData` (sheet-scoped). A confirm/reject reply can arrive after the sheet closes; a sheet-scoped listener would miss it, leaving a pending marker dangling. The App-level listener is the deterministic safety net that guarantees resolution regardless of which screen is shown.
- **Teardown:** the `onDaemonEvent` off-handle is the effect cleanup, so a StrictMode double-mount nets exactly one live listener (the `daemonEventBridge` idiom). No `AbortController` — events are pushed through the existing preload bridge; the outbound `sendCommand` is fire-and-forget (`void`), like the composer. No promise outlives the window.
- **Transport stays out of the renderer:** typed events in, one typed command out — no keys, sockets, or raw frames. `changeId` is renderer-minted, IPC-internal, non-secret, and never serialized onto the wire (it rides as a top-level command sibling, #263).

---

## Error handling

| Failure mode | Where it surfaces | This store's behavior |
|---|---|---|
| Daemon rejects the change | `sessionSettingsRejected` (#269) | Roll back (clear pending) + `error = field`. #257 surfaces the error (copy from the field). |
| Stale / unrelated `changeId` on confirm or reject | `pending.get` returns `undefined` | **No-op, fail-closed** (AC4) — never commits or rolls back the wrong change. |
| Two outstanding changes, one resolves | keyed by `changeId` | Only the matching change resolves; the other stays pending and keeps its optimistic overlay (AC4). |
| Command send fails main-side (`WireEncodeError`) | caught in `connection.setSessionSettings` (#263), send dropped | The renderer never learns; no confirm/reject arrives, so the pending change persists (see Open questions — no timeout in this slice). |
| `sessionId` null at submit time | cannot occur | #257 gates the controls on a non-null session id; `submitSettingsChange`'s signature requires `string`. |
| Network / socket / parse errors | the transport | Not this layer — the store only consumes typed events. |

---

## Testing strategy

Mirror #187's data-path testing: plain-function tests over isolated `createRunSettingsWriteStore()` instances and injected spies — no React, no jsdom (the store/bridge tests run in the node env; the `#242` gotcha). Two test files.

**`runSettingsWriteStore.test.ts` (reducer + derivation, isolated stores):**
- `changeDispatched` records the pending change; `selectEffectiveSettings` (with a fake snapshot) shows the requested value while `confirmed` and the snapshot base are unchanged; `error` cleared to null. *(AC1)*
- `settingsConfirmed` with a matching `changeId` commits the **sent** value into `confirmed`, clears the pending marker; the effective view still shows the value after the marker clears. *(AC2)*
- `settingsRejected` with a matching `changeId` clears the pending marker (view rolls back to the last confirmed / snapshot base) and sets `error` to the field; no optimistic value survives. *(AC3)*
- `settingsConfirmed` **and** `settingsRejected` with a non-matching `changeId` are no-ops — no commit, no rollback, `error` unchanged. *(AC4 fail-closed)*
- Two outstanding changes (distinct `changeId`s): confirming one resolves only its change and leaves the other pending with its optimistic overlay intact. *(AC4 disambiguation)*
- Two outstanding changes to the **same** field: the effective view shows the last-dispatched value; resolving them in either order lands the correct confirmed value.
- `selectEffectiveSettings` composition precedence (pending > confirmed override > snapshot base) per field; empty-string / `yolo:false` held verbatim; `snapshot === null` falls to `'' / '' / false`.
- DI/independence: `createRunSettingsWriteStore(init)` seeds; two stores stay independent; `dispatch` reference stable across updates.

**`runSettingsWriteBridge.test.ts` (data path, spies):**
- `translateWriteEvent` maps `sessionSettingsUpdated` → `{ settingsConfirmed, changeId }` and `sessionSettingsRejected` → `{ settingsRejected, changeId }`; a spot-check of unrelated arms → `null`.
- `subscribeRunSettingsWrite` routes a fake `sessionSettingsUpdated` into `dispatch` as `settingsConfirmed`; an unrelated event no-ops; the returned handle unsubscribes.
- `submitSettingsChange` (per field: model / effort / yolo): mints one `changeId` via the injected mint spy; dispatches `changeDispatched` carrying that `changeId` + the change; sends exactly one `setSessionSettings` command whose top-level `changeId` **equals** the dispatched one (the correlation invariant) and whose payload carries `session_id` + **only** the changed field (assert the other two keys are absent — omitempty).
- `RunSettingsWriteData`: follow the `SessionIdData` coverage split — the helpers carry the logic and are tested directly; the component is thin glue (App-mount + `window.pyry`-in-effect). A dedicated component render test may be omitted.

Type-level coverage: the reducer's `switch` over `RunSettingsWriteEvent` and `submitSettingsChange`'s `switch` over `change.field` stay exhaustive under `npm run typecheck` (a new event arm or field is a compile error). `npm run build` is the salvage/QA gate.

---

## Open questions

- **Should a fresh snapshot clear confirmed overrides?** When the next spawn pushes a snapshot that already reflects the client's change, the override becomes redundant (harmless: override == snapshot). No divergence occurs in the single-client model. Deferred — no observed failure; add clearing only if one appears (evidence-based).
- **Unresolved-pending timeout.** A dropped send or daemon silence leaves a pending change unresolved, so the optimistic value persists with no rollback. This slice adds no timeout — the failure mode is unobserved and a timeout is a stochastic guess at the daemon's latency. Defer to #257 or a follow-up if it bites.
- **`error` on confirm.** `settingsConfirmed` leaves `error` untouched (it clears only on the next `changeDispatched`), so a stale rejection error can briefly outlive a later unrelated success. Acceptable for the machine; #257 may add finer control if the UX needs it.
