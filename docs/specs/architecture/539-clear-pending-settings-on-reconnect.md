# Spec #539 — clear stranded pending settings changes on reconnect

**Ticket:** [#539](https://github.com/pyrycode/pyrycode-desktop/issues/539) · **Size:** XS · Split from #509 (sibling: #538, merged as PR#541)

## Files to read first

Codegraph is not initialized for this repo — `codegraph_status` returns *"CodeGraph not initialized for this project. Run 'codegraph init' first."* — so this list is hand-built from grep + reads rather than lifted from a `codegraph_context` result. All line refs verified at `e45fd9f`; **this slice edits neither `daemonConnection.ts` nor any file below other than the two named in § Design, so every ref stays valid through the change.**

| Path | What to extract |
|---|---|
| `src/renderer/src/store/runSettingsWriteStore.ts:34-41` | The `RunSettingsWriteEvent` union — three arms, each with a `changeId`. The new arm appends after `settingsRejected` and is the first WITHOUT one. |
| `src/renderer/src/store/runSettingsWriteStore.ts:99-142` | `reduceRunSettingsWrite`. **Every arm returns `{ ...state, … }`** — this file's idiom is spread-over-state, unlike `threadTimeline.ts`. Match it; see § "Why a spread here and a literal in #538". |
| `src/renderer/src/store/runSettingsWriteStore.ts:111-113` | The rollback-by-deletion doctrine ("clearing the pending marker IS the rollback") plus the same-reference no-churn rule. AC3 is *this* behaviour reused, not a new one. |
| `src/renderer/src/store/runSettingsWriteStore.ts:125-138` | The two no-match fail-closed early-outs. These are what make a post-clear late reply a same-state no-op — no new guard needed. |
| `src/renderer/src/store/runSettingsWriteStore.ts:174-201` | `selectEffectiveSettings` — pending overlay **beats** confirmed override. The precedence that turns a stranded entry into a permanent lie. |
| `src/renderer/src/store/runSettingsWriteStore.ts:1-22` | The header rationale. "its three transitions (dispatch / confirm / reject)" is falsified by this change — see § 1. |
| `src/renderer/src/store/runSettingsWriteBridge.ts:25-42` | `translateWriteEvent` + its doc. Ends `default: null`, **no exhaustive case cluster** — the new `case` goes immediately above the default. The doc's "consumes only the two correlated write replies" and "Each returns a fresh event carrying only the `changeId`" both need editing. |
| `src/renderer/src/store/modalBridge.ts:61-65` | **The bridge shape to copy.** #415's payload-free `connected` → `reconnected` flip, ack ignored, with the comment that explains why. |
| `src/renderer/src/store/modalPrompts.ts:169-176` | **The reducer shape to copy.** Clear one slice, spread-preserve the rest, early-out to the same reference when the slice is already empty. |
| `src/renderer/src/store/modalBridge.test.ts:8-14, 82-88` | The `HelloAckPayload` fixture and #415's positive `connected` test. `runSettingsWriteBridge.test.ts` has **no `ack` fixture** — the new test needs one; mirror this. |
| `src/renderer/src/store/runSettingsWriteBridge.test.ts:37-52` | The null-sample array. It lists `connecting` and `disconnected` but **not** `connected` — nothing to delete here (AC5). |
| `src/renderer/src/store/runSettingsWriteStore.test.ts:28-188` | The reducer describe block: isolated `createRunSettingsWriteStore()` per test, the `change()` helper (`:26`), the `snap` fixture (`:18-24`), and the precondition-then-assert style. The new block mirrors it. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:325-331` | `useRunSettingsWriteStore((s) => s)` — the **whole raw state** is the selector. This is why the same-reference early-out (AC4) is load-bearing, not cosmetic. Read-only; no edit. |
| `src/main/daemonConnection.ts:1471-1511` | `dial()` — the single start/reconnect funnel. `driver = null` (`:1476`) precedes `pendingSettings.clear()` (`:1490`) precedes the `connecting` emit (`:1504`). The ordering proof in § "No new race" rests on this. Read-only; **out of scope**. |
| `src/main/daemonConnection.ts:1366-1391` | `setSessionSettings` — `if (driver === null) return`, then send, then record. The other half of the ordering proof. Read-only. |
| `src/main/transport/noiseRelayDriver.ts:370-374` | `session?.sendMessage` is **inert pre-transport and does not throw**. The third half. Read-only. |
| `docs/specs/architecture/538-timeline-reconnected-arm.md` | The sibling that did this job for the timeline. Same skeleton; the two places this slice deliberately diverges are called out below. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

The Run configuration sheet: a dark scrolling column of labelled groups — Model as three radio rows with sub-captions, Effort as a five-segment pill control, YOLO mode as a caption row plus a right-aligned toggle, then Context window and Log data below. This slice changes **which value** the Model radio, the Effort segment and the YOLO toggle read back after a reconnect; it adds no element, alters no token, and changes no layout. No pixels move.

## Context

A `changeDispatched` entry leaves `pending` only via a correlated confirm or reject (`runSettingsWriteStore.ts:125-138`), and the bridge maps only those two events (`runSettingsWriteBridge.ts:33-42`). Main abandons its envelope-id → changeId correlation on every re-dial (`daemonConnection.ts:1490`) and emits nothing in its place, so the reply for an in-flight change can never arrive. The entry strands forever.

That is worse than a stuck banner. `selectEffectiveSettings` gives pending entries precedence over confirmed ones (`:181-195` overwrite the `??` chain at `:196-200`), so the stranded entry lies about the applied value — and because a later same-field change deletes its **own** entry on confirm, the stranded one becomes the surviving overlay. The sheet reverts to the never-applied value permanently while the daemon runs the confirmed one. On the YOLO toggle that means the sheet can show auto-approval off while the daemon runs with it on.

`modalStore` (#415), `queueStore` (#197) and the thread timeline (#538) all already reconcile on the `connected` edge. This store is the last of the four.

**Why `connected` and not `disconnected`** — carried from the ticket body and independently re-verified here: `{ type: 'disconnected' }` is emitted **nowhere** in `src/main`. The three `emitDaemonEvent` call sites in the connection module are `failed` (`daemonConnection.ts:439`), `connected` (`:483`) and `connecting` (`:1504`); the only other production emit is the pass-through at `liveWindow.ts:87`. The `disconnected` arm exists in the union (`src/shared/ipc/events.ts`) and `daemonEventBridge` can translate it, but in production it is reachable only as `sessionStore`'s initial value. Wiring the clear to it would ship an arm that never fires — with a green suite, because a unit test can synthesize the event the app never sends.

## Design

Two production files. No new files, no new modules, one new exported union member.

### 1. `runSettingsWriteStore.ts` — a new `RunSettingsWriteEvent` arm

Append after `settingsRejected` (`:41`):

```ts
| { type: 'reconnected' }
```

The first arm without a `changeId` — it is not correlated to anything, because its whole job is to abandon correlations. Document it as connection-lifecycle (bridge-produced from the `connected` wire edge, carrying no daemon content), in contrast to the three change-scoped arms.

Two doc comments are falsified by this arm and must be edited, not left:

- `:12-14` — "its three transitions (dispatch / confirm / reject) are CORRELATED and each reads prior state". Now four. The reducer-vs-named-setters rationale **survives and strengthens**: `reconnected` also reads prior state (the early-out below), it is just not correlated. Reword rather than delete — say the fourth is uncorrelated but still prior-state-reading.
- `:34-37` — "the outgoing user action plus the two incoming daemon events, each keyed by the renderer-minted `changeId`". The "each keyed by" clause is now false.

### 2. `runSettingsWriteStore.ts` — the reducer arm

Add `case 'reconnected'` after `case 'settingsRejected'` (`:138`), before the `default`. Contract:

- **Clears** `pending` to a fresh empty `Map`, regardless of how many entries were outstanding (AC1).
- **Preserves** `confirmed` and `error` (AC3) — a standing rejection is still true after a reconnect, and a previously confirmed override is still what the daemon has.
- **Early-out** to the same `state` reference when `state.pending.size === 0` (AC4).

Use a fresh `new Map()`, not `initialRunSettingsWriteState.pending`. Aliasing the shared constant would be safe today (every arm copy-on-writes before mutating), but it is a latent footgun for zero gain — the early-out means the allocation only happens when there was something to clear.

The rollback is free: AC3 asks for no new mutation. Deleting the pending markers **is** the rollback, because `selectEffectiveSettings` then falls through to the confirmed override or the snapshot base. That doctrine is already written at `:111-113`; this arm is its fourth caller, not a new mechanism.

#### Why a spread here and a hand-written literal in #538

Sibling #538 argued *against* `{ ...initialTimelineState, items: state.items }` — a future sixth field would be silently wiped. The mechanism inverts here and the conclusion inverts with it. This arm spreads **`state`**, not the initial constant, so an unknown future field is **preserved** by default, which is the conservative direction and matches AC3's posture (clear the one thing that strands; leave everything else alone). It is also this file's idiom: all three existing arms return `{ ...state, … }`. The residual is the mirror image of #538's and worth one inline comment: a future field that is *pending-scoped* would need adding to this arm by hand, and TypeScript will not force it. State that; do not build a mechanism for it.

#### The early-out is load-bearing, not cosmetic

`RunConfigSections.tsx:327` selects the **whole raw write state** (`useRunSettingsWriteStore((s) => s)`) — deliberately, so `Object.is` stays meaningful. Returning the same reference makes zustand's `setState` skip the notify entirely (`Object.is(nextState, state)` short-circuits before any listener runs), so a first connect, or any reconnect with nothing in flight, re-renders nothing. Without it every reconnect would re-render the entire sheet. Say so where the early-out lives.

### 3. `runSettingsWriteBridge.ts` — own the `connected` arm

Add, immediately above `default: null` (`:39`):

```ts
case 'connected':
  return { type: 'reconnected' }
```

A fresh nullary literal. `event.ack` (`HelloAckPayload`) is ignored — this arm needs no field off it. Placement mirrors `modalBridge.ts:61`.

Update the translator's doc (`:25-32`), which is wrong in two places after this change: "this path consumes only the two correlated write replies" (now three events, two correlated), and "Each returns a fresh event carrying only the `changeId` correlation key" (the new one carries nothing). Keep the `default: null` rationale as written — ignoring the rest is still the intended permanent behaviour.

Nothing else in this file changes. `subscribeRunSettingsWrite` already dispatches any non-null translation; `RunSettingsWriteData` already mounts app-level. Its existing rationale (`:111-120`) — a reply can arrive after the sheet closes, so the listener cannot be sheet-scoped — now covers a second case for free: the reconnect edge fires whether or not the sheet is open. Worth one clause; optional.

Do **not** touch `daemonEventBridge.ts`, `sessionStore.ts`, `modalBridge.ts`, `queueBridge.ts` or `timelineBridge.ts`. They are independent consumers of the same `connected` edge; this slice adds the fifth, it does not centralise them.

### No new race (the ordering proof)

The natural worry: does clearing on `connected` — the *rising* edge — drop a change that was genuinely in flight? Walk one dial:

1. `dial()` sets `driver = null` (`:1476`), then `pendingSettings.clear()` (`:1490`), then emits `connecting` (`:1504`).
2. `bootstrap` creates the driver (`:985`) and the handshake runs. **A change dispatched anywhere in this window is already dead on arrival**: `setSessionSettings` passes its `driver === null` guard once the driver exists, but `noiseRelayDriver.sendMessage` is `session?.sendMessage(...)` — inert before transport state and **it does not throw**, so the frame is silently dropped while `pendingSettings.set` still records an entry (`:1386`) for a reply that can never come. The clear is the *fix* for these, not a hazard to them.
3. `handshake-complete` → `connected` emitted (`:483`).
4. The renderer receives `connected` and clears.

The only window where a change is genuinely sent and then cleared is between (3) and (4) — one asynchronous IPC hop. See the residual below.

A confirm or reject for an already-cleared entry needs no new handling: it hits the existing no-match fail-closed guards (`:127`, `:134`) and returns the same state object. No new late-reply hazard, and nothing to add.

### Accepted residuals — do not engineer around either

1. **The outage window.** Because the clear fires on reconnect rather than on the drop, the sheet still shows the optimistic never-applied value *for the duration of the outage*. Unavoidable given that `disconnected` is never emitted. This is not the bug — the bug is that the lie is currently permanent and outlives later confirmed changes.
2. **The one-IPC-hop window.** A change dispatched between main emitting `connected` and the renderer receiving it is really sent and really correlated, and the clear then drops its pending entry; the daemon's confirm arrives as a no-match no-op, so the value never commits to `confirmed` and the sheet shows the base value while the daemon has the change queued for the next session spawn (ADR 031). Bounded to a single `webContents.send` hop and requires a click inside it. Nothing strands, nothing compounds, and it is strictly narrower than today's behaviour on the same reconnect. Closing it would need per-change generation correlation across the IPC boundary — far more machinery than the defect justifies. Name it; do not fix it.

### A claim in the ticket body to correct

The ticket notes that clearing `pending` "also drops every per-field in-flight flag (`selectPendingFields`), so #257's controls re-enable on reconnect." The property is real but **latent**: `selectPendingFields` has no consumer anywhere in `src/` outside its own test — `RunConfigSections` passes `model`/`effort`/`yolo`/`usedTokens`/`windowTokens`/`onChange`/`errorField` to `RunConfigView` and no pending flags. There is no user-visible re-enable to observe, assert, or guard. Do not go looking for the wiring, and do not add it here.

### State + concurrency model

No new state, no new async surface, no new subscription, no new IPC channel. The arm is a pure function of `(RunSettingsWriteState, RunSettingsWriteEvent)`; the bridge is an existing subscriber on an existing channel. Ordering is arrival order per ADR 0004 — the transport emits `connected` before any post-handshake reply on the single daemon-event channel, dispatched synchronously per event, so there is no reset-before-repopulate ordering logic to write (the `queueBridge.ts:35-42` argument, unchanged). Teardown is unchanged: `RunSettingsWriteData`'s effect cleanup already nets one live listener under StrictMode.

### Error handling

No new failure modes. The arm is total (nullary event, no parse, no I/O); the bridge is a pure translator. A future `RunSettingsWriteEvent` arm without a reducer case remains a compile error via the existing `assertNever` (`:139-140`) — the one place in this pair that is compile-forced.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two existing test files, no new ones. Scenarios as bullets — write them in each file's existing idiom.

### `runSettingsWriteStore.test.ts` — a new `reconnected` describe

- **Clears every outstanding entry (AC1).** Dispatch three changes across all three fields, assert `pending.size === 3` as a precondition, dispatch `reconnected`, assert `pending.size === 0`. The precondition assert is the point — without it the test passes on a store that never recorded anything.
- **Rolls the display back to the last confirmed value, else the snapshot base (AC3).** From a state with `confirmed: { model: 'haiku' }` plus one pending `model: 'opus'`: after `reconnected`, `selectEffectiveSettings(snap, s).model` is `'haiku'`. From a state with a pending `yolo: true` and no confirmed override: after `reconnected`, `.yolo` is `snap.yolo`. Two cases, both cheap, and together they pin that the rollback is by deletion rather than by a new mutation.
- **`confirmed` and `error` survive (AC3).** Seed via `createRunSettingsWriteStore({ pending: <one entry>, confirmed: { effort: 'high' }, error: 'yolo' })`; after `reconnected`, `confirmed` still `{ effort: 'high' }` and `selectError(s)` still `'yolo'`. The `error` half is the one a naive `{ ...initialRunSettingsWriteState }` implementation would break.
- **Same-reference no-op when nothing is pending (AC4).** `reduceRunSettingsWrite` is not exported, so assert through the store: capture `store.getState()`, dispatch `reconnected` on a store with empty `pending` but a **non-empty** `confirmed` + a standing `error`, and assert the state object is `toBe` the captured one. Use the dirty-but-not-pending state, not the pristine initial state — that is the case that actually pins the predicate on `pending.size` rather than on the whole state being empty.
- **Idempotent.** A second `reconnected` returns the same reference as the first.
- **A change dispatched after the clear behaves normally.** `reconnected` then `changeDispatched` then `settingsConfirmed` ⇒ commits to `confirmed`. Proves the clear does not latch the store into a dead mode.
- **The compounding regression (AC2) — the central test.** Dispatch `c1` `model: 'opus'`; dispatch `reconnected`; dispatch `c2` `model: 'sonnet'`; dispatch `settingsConfirmed` for `c2`. Assert `selectEffectiveSettings(snap, s).model === 'sonnet'` **and** `pending.size === 0`. Then fire a late `settingsConfirmed` for `c1` and assert the effective model is still `'sonnet'` and `confirmed.model` is still `'sonnet'` — that last step is what pins "cannot resurface" rather than merely "is currently absent", and it is the assertion a regression would have to defeat. Without the fix this test reads `'opus'` at the first assertion.

### `runSettingsWriteBridge.test.ts`

- **`connected` → a payload-free `reconnected`, ignoring the ack.** Add a module-level `HelloAckPayload` fixture mirroring `modalBridge.test.ts:8-14`, then `expect(translateWriteEvent({ type: 'connected', ack })).toEqual({ type: 'reconnected' })`. No existing assertion is deleted — the null-sample array (`:37-52`) never listed `connected`, so unlike #538 there is no stranded-fixture footgun here.
- **`subscribeRunSettingsWrite` routes it into `dispatch` (AC5).** Emit `{ type: 'connected', ack }` through `fakeBridge` and assert `dispatch` was called once with `{ type: 'reconnected' }`. The translator test alone does not prove the subscribe path forwards it.
- **Leave the `others` array and the "does not dispatch for an unrelated event" test (`:102-109`, which uses `connecting`) untouched.** Both stay correct.

## Fan-out proof (why this is XS)

Verified by grep at `e45fd9f` (codegraph unavailable). `RunSettingsWriteEvent` appears in exactly five places outside the two files being edited and their tests:

- `runSettingsControls.ts:12,24` — a **contravariant** `dispatch: (event: RunSettingsWriteEvent) => void` prop type. Widening the union widens the prop in place; existing callers pass the store's `dispatch` (identical type) and construct only pre-existing members. Cannot break.
- `RunConfigSections.tsx` — reads selectors and `writeState.dispatch`; never names the union, never switches on it.
- `queueStore.ts:10,54` and `newFolderStore.test.ts:11`, `newFolderBridge.ts:57` — prose references in comments only.

The union is switched over in exactly two places, both inside the edited files: `reduceRunSettingsWrite` (`:119`, guarded by `assertNever`) and — for the *source* union `DaemonEvent` — `translateWriteEvent` (`:34`, `default: null`, so a widened `DaemonEvent` forces nothing). **Two production files change; zero consumer call sites; no edit is forced anywhere else.**

**Scope self-check:** 2 production source files (`*.ts`/`*.tsx`, excluding tests and this spec) — well under the ≥5 gate. Projected total written work ≈ 30 production lines + ~120 test lines + comment edits, no new reject branches, no new files. XS confirmed; no split.

## Open questions

None blocking. One deferred item, out of scope here and shared with #538: advertising a replay cursor (`HelloClientPayload.last_seen_ts` is plumbed but never populated at `daemonConnection.ts:922`; `last_event_id` is absent from the desktop wire type) would let the daemon redeliver a missed reply itself. That is a transport-level change of its own and would not remove the need for this arm — a settings reply is not replayable state, and the main-side `pendingSettings.clear()` abandons the correlation regardless. Worth a PO follow-up, not a blocker.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This slice adds no boundary crossing. The one datum it consumes — the `connected` discriminant — is already parsed and validated upstream in main (`parseHelloAck` at `daemonConnection.ts:472-481`, fail-closed to `emitFailed('malformed-hello-ack')` on a malformed ack), and the new arm reads **only the discriminant**, never `event.ack`. Nothing untrusted enters the store: the arm carries no field at all. The store's inputs remain what they were — a renderer-minted `changeId` and a user-chosen enum value.
- **[Tokens, secrets, credentials]** Not applicable by construction, stated rather than assumed: the store holds `Map<string, SettingsChange>`, three optional scalars, and one field name. No token, key, or credential is in reach, and the new arm carries nothing across the boundary. `changeId` is a client-minted IPC-internal correlation key that never reaches the wire (`daemonConnection.ts:1376-1378`) and is not a secret; the clear discards them, it does not transmit them.
- **[File / storage operations]** No findings — no filesystem, no `localStorage`, no persistence of any kind. The store is in-memory renderer state that dies with the window.
- **[Inter-process / Electron attack surface]** No findings. No new `contextBridge` API, no new `ipcMain` channel, no new preload surface. The bridge subscribes to the pre-existing `onDaemonEvent` channel and consumes one more of its existing arms. `RunSettingsWriteData` remains headless and dereferences `window.pyry` only inside its effect.
- **[Cryptographic primitives]** Not applicable — no RNG, no comparison, no key or nonce handling. `crypto.randomUUID()` at `runSettingsWriteBridge.ts:102` is pre-existing, untouched, and non-security (a correlation key, not a capability).
- **[Network & I/O]** No findings — no socket, no fetch, no timeout, no frame handling. The slice is downstream of the transport by two layers.
- **[Error messages, logs, telemetry]** No findings, and one deliberate non-addition: this slice adds **no** log call. A "cleared N pending settings changes on reconnect" line would be content-free and tempting, but the count correlates with user activity during an outage and there is no observed need for it (#126's posture — log the event type, not the user's behaviour). `error` holds a field *name* only; `sessionSettingsRejected` already strips daemon text (#269), so no daemon-controlled string can reach a log through this path.
- **[Concurrency]** One finding, addressed in the design rather than left implicit: the check-then-act question is *"can the clear drop a change that is genuinely in flight?"* The ordering proof in § "No new race" answers it in main's own code — during the whole dial window `sendMessage` is inert (`noiseRelayDriver.ts:370-374`) and the frame never leaves, so those changes were already unreconcilable; the clear is their fix. The one genuine window is the single IPC hop between the `connected` emit and its receipt, bounded and documented as accepted residual 2. No new task, timer, listener, or `AbortController` is introduced, so there is nothing new to cancel on teardown.
- **[Threat model alignment]** Two desktop-specific threats named:
  - **Malicious / compromised relay.** A hostile on-path relay can force reconnects at will by dropping the socket, so it fully controls *when* this clear fires. Post-change, each forced reconnect empties `pending` — a same-state no-op when nothing is outstanding, and a rollback to the last confirmed value otherwise. It cannot cause the display to over- or under-report an *applied* setting, because the daemon applies only what the user actually sent and `confirmed` is untouched by the clear. Pre-change, the same capability lets a relay strand an entry permanently and make the sheet lie about YOLO indefinitely. **This slice strictly reduces relay-induced exposure**; residual 2 leaves a one-IPC-hop window that a relay can invite but not time.
  - **Hostile daemon response.** A confirm or reject for a cleared `changeId` — whether a late honest reply or a forged one from inside the session — is rejected by the existing no-match guards (`:127`, `:134`) and cannot commit a value into `confirmed`. The clear makes the store *more* fail-closed here, not less: it shrinks the set of `changeId`s that a reply can successfully correlate against.
  - **Renderer compromise reaching the transport** — unchanged and out of scope for this slice; a compromised renderer could already call `submitSettingsChange` directly.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
