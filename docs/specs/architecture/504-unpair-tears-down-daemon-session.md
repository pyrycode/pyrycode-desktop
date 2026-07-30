# #504 — Unpair tears down the live daemon session

**Size:** S (2 production files, 2 test files, ~105 total LOC). No split.
**Base:** anchors below re-read at `main` `b02e7b4` (the ticket body's anchors were read at `8c0d013`; #518 has landed since — two body anchors are stale, corrected below).

## Design source

N/A — main-process wiring only. The renderer half (the unpair control, the confirm sheet, the route flip) already exists and is explicitly out of scope per the ticket body; no pixel changes.

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/unpairHandler.ts:40-65` | The whole function you are changing. Note the log-free / classify-don't-forward discipline stated at `:11-16` — it constrains the new code. |
| `src/main/pairingHandler.ts:46-60` | The `onPaired?: () => void` dep + its docstring at `:51-57`. Clone the **contract wording**; deliberately do NOT clone the call placement (see Design §3). |
| `src/main/pairingHandler.ts:98-109` | `onPaired?.()` sits *inside* the try at `:103`. This is the shape being rejected, and why. |
| `src/main/index.ts:144-165` | The three store-only registrations. Two comment blocks here go stale when unpair moves (§2) — `:147-153` and `:159-163`. |
| `src/main/index.ts:188-223` | `createDaemonConnection` `:188`, the pairing handler's "registered now that `connection` exists" block `:197-204`, `onPaired: () => connection.reconnect()` `:215`. This is the destination and the template. |
| `src/main/daemonConnection.ts:1439-1475` | `dial()`. The entire teardown. Read every line — the ordering is load-bearing (§1). |
| `src/main/daemonConnection.ts:965-972` | The generation fence on the driver's `onEvent`. This is the mechanism that satisfies AC3. |
| `src/main/daemonConnection.ts:936-953` | `bootstrap` — the `dc === null` branch at `:944-947` returns before `createDriver` `:954`. Satisfies AC2's second half. |
| `src/main/daemonConnection.ts:1483-1496` | `reconnect()` vs `stop()`. Only `stop()` sets the permanent `stopped` flag — the AC5 proof. |
| `src/renderer/src/screens/conversation/unpairAction.ts` | `runUnpair`'s docstring + body: `result:'error'` **and** a rejected invoke are coerced to the same path (stay on the conversation screen, never flip). This is what decides §3. Read-only — do not edit. |
| `src/main/unpairHandler.test.ts:9-33` | `fakeTarget` / `listenerOf` / `storeWithClear` helpers to reuse. `:109-131` is the log-free test the new code must not break. |
| `src/main/daemonConnection.test.ts:68-137` | Fake driver (`stopped` `:71`/`:100-101`, `emit` `:76`/`:91`) and `fakeSink`/`emitted` `:114-137`. |
| `src/main/daemonConnection.test.ts:154-207` | `makeStores` / `build({ load })` / `tick` / `reachConnected`. **Corrected anchor** — the body cited `:135-147`. |
| `src/main/daemonConnection.test.ts:912-930` | "connects after a not-paired boot" — the exact inverse of the regression test, including the mutable-`load` counter idiom. **Corrected anchor** — the body cited `:858`. |
| `src/main/daemonConnection.test.ts:541-551` and `:650-658` | The "no driver constructed + failed(not-paired)" assertions, and the `message`→`messageReceived` drive idiom to reuse as the positive control. |

## Context

`registerUnpairHandler` erases the stored pairing and does nothing else. Nothing stops or re-dials the daemon connection, and `daemonConnection` reads the record only at dial time (`loadDialConfig` → `pairedServer.load()`, `:886-887`), so an established Noise session outlives the record that authorised it. The renderer resets and routes to the pairing screen, then incoming events from the still-live session repopulate both stores behind it — a not-paired UI backed by a live authenticated session, until the socket happens to drop.

The fix is one wire: give the unpair handler the same optional post-success callback the pairing handler already has, and point it at `connection.reconnect()`.

## Design

### 1. `connection.reconnect()` is the entire teardown — zero `daemonConnection.ts` edits

Verified line by line at `b02e7b4`. Calling `reconnect()` after the record is erased runs this sequence:

1. `reconnect()` `:1483-1489` — `stopped` is false, so it sets `started = true` and calls `dial()`.
2. `dial()` `:1441` — `const gen = ++generation`. **This is the fence, and it is the first statement in the function.** Every live driver's `onEvent` wrapper closed over the `gen` of *its* dial (`:969-972`); the bump makes `gen !== generation` true, so the wrapper `return`s before `onDriverEvent`. Every session-scoped event the superseded driver emits from this instant — `connected`, `messageReceived`, `messagesReceived`, `assistantDelta`, `turnState`, `toolUse`, `toolResult` — is dropped **upstream of all decoding and all emission**. That single fence is the whole of AC3.
3. `:1446-1447` — `driver?.stop(); driver = null`. The real driver's `stop()` calls `supervisor.stop()` (`noiseRelayDriver.ts:361-362`), which closes the relay socket. The authenticated session is **closed**, not merely muted — the daemon observes a real disconnect. AC2, first half.
4. `:1468` — `emitDaemonEvent(sink, { type: 'connecting' })`, synchronously.
5. `void bootstrap(gen)` → `loadDialConfig()` reads the now-erased store → `null` → `:944-947` emits `failed{not-paired}` and returns **before** `createDriver` at `:954`. AC2, second half.

`dial()` never touches `stopped` — only `stop()` does, at `:1492`. So a later re-pair's `onPaired` → `reconnect()` path is bit-for-bit unchanged. AC5.

Two independent deterministic mechanisms cover AC3: the socket is closed *and* the fence drops anything already in flight. Do not add a third.

**Do not open `daemonConnection.ts` to edit it.** The production diff is `unpairHandler.ts` + `index.ts`.

**Accepted consequence.** The renderer sees a transient `connecting` followed by `failed{not-paired}`. AC3 permits exactly these. `reduceSession` (`sessionStore.ts:109`) applies them unconditionally after `reset`, so the session store settles at `failed{not-paired}` rather than pristine `initialSessionState`. Benign: `runUnpair` has already flipped the route to `pairing`, and `appRoute.ts` derives the launch route from the pairing-status query — never from session status — so nothing re-routes. A later re-pair overwrites the store via `connecting`/`connected`. A dedicated `disconnect()` would avoid the transient at the cost of a new public method and a new connection state; rejected.

### 2. Move the registration below the connection

`registerUnpairHandler` is at `index.ts:154`; `createDaemonConnection` is at `:188`. It cannot close over `connection` where it sits. Move it to sit beside the pairing handler (`:212-217`), which is there for exactly this reason. Move the paired `app.on('will-quit', …)` line with it.

Three comment blocks need updating — the repo treats these as load-bearing, and two of them become factually wrong on the move:

- **`:147-153` (the unpair block)** — moves with the registration and must be rewritten: it currently asserts the handler "needs only the store — no `connection`". That is now false. Record the new dependency and keep the existing justification for why registering late is safe: "No caller races it: the visible unpair UI is #166/#167," plus the pairing block's point at `:202-204` that the whole `whenReady` callback runs to completion in one tick while an operator-driven invoke arrives many ticks later, after first paint.
- **`:159-163` (the server-info block)** — says "Grouped with the pairing-status / unpair registrations" and "`will-quit` removes the handler, symmetric with unregisterUnpair." Both referents leave the group. Repoint to `unregisterPairingStatus`.
- **`:197-204` (the pairing block)** — mentions only the pairing handler's reason for being below `connection`. Extend or leave; do not contradict it.

### 3. Callback placement: after the erase, in its own try/catch, result stays `ok`

Add to `registerUnpairHandler`'s `deps`:

```ts
/**
 * Called once after clear() erases the record — the teardown-on-unpair trigger (#504).
 * A trusted in-process callback, value-free (no record/token/key crosses). Never called
 * when clear() throws. MUST NOT throw; a throw is dropped rather than downgrading the
 * already-completed erase to `error` — see the spec's §3.
 */
onUnpaired?: () => void
```

Behaviour: `await store.clear()` inside the existing try; on success, invoke `onUnpaired?.()` guarded by its own try/catch that **drops** the caught object; return `{ result: 'ok' }`. The existing catch still maps a `clear()` throw to `{ result: 'error' }` with the callback never fired.

This deliberately deviates from `onPaired` (`pairingHandler.ts:103`, inside the try). The reason is in `unpairAction.ts`: `runUnpair` coerces **both** `result: 'error'` **and** a rejected invoke to the same outcome — dispatch `failed`, stay on the conversation screen, never flip the route. So both alternatives (clone `onPaired`; let the throw propagate) produce a paired-looking UI backed by an already-erased record — the precise inverse of the half-state `runUnpair` was built to prevent, and worse than the bug being fixed.

By the time the callback can throw, both security-critical steps are already complete: `clear()` resolved, and `dial()`'s *first* statement armed the fence. Reporting `error` would be reporting failure for a doubly-completed operation. The swallow matches the module's own stated discipline (`unpairHandler.ts:53-60`) and the transport's (`daemonConnection.ts:1408-1410`, `:974-981`).

The dep is optional, so the existing call site and every existing test are unaffected.

### 4. Composition root

```ts
const unregisterUnpair = registerUnpairHandler(ipcMain, {
  store: pairedServerStore,
  onUnpaired: () => connection.reconnect()
})
```

Mirrors `onPaired: () => connection.reconnect()` at `:215`. `index.ts:200-202` already documents `reconnect()` as synchronous, void, and non-throwing — the same contract this dep needs, already asserted in-repo.

## State + concurrency model

No new state, no new async task, no new listener, no timer. The callback is synchronous and void.

- **In-flight bootstrap.** A bootstrap awaiting `loadDialConfig()` when unpair fires is abandoned silently by the gen check at `:943`, which sits *before* the not-paired branch specifically so a superseded bootstrap emits nothing.
- **Concurrent re-pair.** If a pairing confirm interleaves with an unpair across the `await`, both callbacks call `reconnect()`, and each re-dials whatever the store holds at that moment. The teardown is not "disconnect" — it is "re-dial from disk" — which is why it is race-safe by construction: every ordering converges on "connected to the record currently on disk, or not-paired if there is none."
- **Repeated unpair.** Idempotent and cheap: `clear()` is already idempotent, and with no record each `reconnect()` bumps the fence, finds no driver to stop, and returns from bootstrap before constructing one. No socket is dialled, so no backoff or retry-storm surface.
- **Duplicate sockets.** Unchanged: `dial()` stops the old driver before constructing a new one (`:1442-1447`).
- **Shutdown.** Unchanged: `will-quit` removes the handler and stops the connection.

## Error handling

| Failure | Result |
|---|---|
| `clear()` throws | `{ result: 'error' }`, callback never fires, no teardown. Byte-identical to today (AC1). |
| `onUnpaired` throws | Caught, object dropped, `{ result: 'ok' }`. Record is erased and the fence is armed; see §3. |
| No record at teardown | `failed{not-paired}`, no driver constructed (`:944-947`). |
| Handler invoked before registration | Invoke rejects; `runUnpair` coerces to the error path — fail-safe, nothing erased, no half-state. Not reachable in practice (§2). |

The caught object is never logged, interpolated, or returned. `unpairHandler.ts` is log-free by construction and must stay so.

## Testing strategy

### `unpairHandler.test.ts` — reuse `fakeTarget` `:9-14`, `listenerOf` `:18-22`, `storeWithClear` `:27-33`

- `onUnpaired` fires exactly once, with no arguments, after a successful `clear()`.
- `onUnpaired` never fires when `clear()` throws, and the result is still `{ result: 'error' }`.
- A throwing `onUnpaired` still resolves `{ result: 'ok' }` and never rejects — pins the §3 deviation so a future "tidy-up" back to `onPaired`'s shape fails loudly.
- Extend the existing log-free test (`:109-131`) to cover the throwing-callback path: neither `console.error`, `.log`, nor `.warn` is called.

### `daemonConnection.test.ts` — the AC4 regression test

**This test must compose `registerUnpairHandler` with a real `DaemonConnection`.** Driving `connection.reconnect()` directly would pass on `main` unchanged and prove nothing — `reconnect()` already fences. AC4 says "run the unpair path," and the fix *is* the wiring, so the wiring is what the test must exercise. There is no `index.test.ts`, so the test composes the root's two lines itself (the same technique #518 used for its orchestrator AC).

Setup: one mutable `record` variable shared by two closures — `build({ load: () => Promise.resolve(record) })` and a fake `ClearablePairedServerStore` whose `clear()` sets `record = null`. That models the real store (clear erases; load reads through) with no new helper.

Scenario, in order:

- Reach connected with the record present — inline the three lines from `reachConnected` `:201-207` (it can't be reused; it hardcodes the always-`RECORD` default `load`).
- **Positive control:** drive a `message` frame via the `:655` idiom and assert `messageReceived` reaches the sink. Without this the "nothing arrives" assertion can pass vacuously on a mis-shaped fixture.
- Register the unpair handler against a `fakeTarget`, with `onUnpaired: () => connection.reconnect()`; invoke its listener and await the result. Assert `{ result: 'ok' }`.
- `await tick()`.
- Assert `drivers[0].stopped === true`, `drivers` still has length 1 (no replacement driver), and the last event is `failed{not-paired}`.
- Drive the **same** `message` frame from `drivers[0]` again; assert no new `messageReceived` reaches the sink.
- Assert the only events after the teardown are `connecting` then `failed{not-paired}`.

**Why it fails on `main`:** `onUnpaired` is not a parameter there, so the extra property is an excess-property type error (`npm run typecheck` fails) and, since vitest strips types, at runtime the callback is simply ignored — no teardown, the driver stays live, and the re-driven `message` reaches the sink, so the assertion fails. Both gates go red on `main` and green after the fix. The developer must actually run the test against `main` to confirm, not assume it.

## Open questions

None blocking. Two decisions were made deliberately rather than deferred, and a reviewer should read them as decisions, not oversights: the transient `connecting`/`failed{not-paired}` is accepted rather than designed away (§1), and the callback swallows its own throw rather than cloning `onPaired` (§3).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The change adds no data-carrying boundary. `UNPAIR_CHANNEL` already carries no request argument (`unpairHandler.ts:24-25`, `:46`), and the new dep is an in-process callback wired at the composition root — not renderer-reachable and value-free. The renderer's capability is unchanged: it can still only *trigger* an erase. The change widens the *effect* of that trigger (it now also tears down the transport), which brings the effect in line with its stated intent rather than granting new reach.
- **[Tokens, secrets, credentials]** No findings; the change strengthens this category — it is the reason the ticket carries the label. Today the token-authenticated Noise session outlives the erased record until the socket drops or the app restarts; after the fix, revocation of the on-disk record and teardown of the session it authorised are one atomic user action. `driver.stop()` closes the socket (`noiseRelayDriver.ts:361-362`), so the daemon observes a real disconnect rather than a silently-abandoned session. No new token handling; `clear()` (#172) is untouched and still fail-closed.
- **[Tokens — in-memory residue]** OUT OF SCOPE. The superseded driver's captured `hello` payload and connection headers hold the token as JS `string`s until GC; `driver = null` (`:1447`) drops the last reference but nothing zeroizes. Not introduced here — records are plain objects repo-wide, and JS strings are not zeroizable. Closing it would mean holding secrets in `Buffer`s across the whole record path; a separate ticket if the threat model ever demands it.
- **[File / storage operations]** N/A by design. No new filesystem path, no new read/write, no path concatenation. The only storage operation is the existing `store.clear()`.
- **[Inter-process / Electron attack surface]** No findings. No new channel, no new `contextBridge` surface, no `webPreferences` change. The move preserves `ipcMain.handle`'s one-handler-per-channel discipline and the exact-teardown `will-quit` pairing. The move's one theoretical risk — an invoke arriving before registration — is fail-safe: the invoke rejects, `runUnpair` coerces to the error path, and nothing is erased, so no half-state. Not reachable in practice (`index.ts:202-204`: the `whenReady` callback completes in one tick; the unpair UI is post-first-paint).
- **[Cryptographic primitives]** N/A by design. No key, nonce, handshake, or AEAD code is touched. The Noise session is destroyed via the existing `stop()` path and — with no record — is not re-created, so there is no `(key, nonce)` reuse surface. `dial()`'s reset of `nextEnvelopeId` and the correlation maps (`:1451-1464`) is pre-existing and applies to a fresh session only.
- **[Network & I/O]** No findings. No new socket, no new frame handling; `maxPayload` and timeout discipline are untouched. Worth stating positively: because bootstrap returns before `createDriver` when no record is stored, a post-unpair state performs **no dial at all** — so repeated unpair cannot spin a reconnect or token-exhaustion loop, and needs no backoff.
- **[Error messages, logs, telemetry]** SHOULD FIX (developer discipline, code-review to verify). `unpairHandler.ts` is log-free by construction (`:11`) and the new callback's dropped throw must not break that — a caught object here could carry internal state or a path. The enforcement already exists at `unpairHandler.test.ts:109-131`; the testing strategy extends it to the throwing-callback path. Separately, an unpair now emits `daemon-dial` (`:1472`) and `daemon-failed(not-paired)` into the diagnostic log; both are content-free and coordinate-free by construction (`:1469-1471`) — no token, no host, no path.
- **[Concurrency]** No findings; analysed in State + concurrency model. The check-then-act gap across `await store.clear()` is race-safe because the teardown re-dials from disk rather than transitioning to a "disconnected" state — every interleaving with a concurrent re-pair converges on "connected to whatever record is on disk, or not-paired if none." In-flight bootstraps are abandoned by the gen check at `:943` before they can emit. No new async task, timer, or listener is created, so there is nothing new to cancel.
- **[Threat model alignment]** No findings. *Malicious relay:* teardown is purely local and requires no round-trip, so an on-path relay cannot delay or suppress it. *Hostile daemon response after unpair:* this is exactly what the fix closes — post-teardown events are dropped at `:970`, upstream of any decode. *Renderer compromise:* a compromised renderer can trigger unpair (an availability nuisance, already available to it via `clear()`) but gains no key, token, or socket reach; the callback is value-free. *Server-side token invalidation* is a daemon concern in the upstream `pyrycode` repo and is not in this client's scope.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
