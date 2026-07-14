# #415 — Reconnect reconcile (renderer): clear the outstanding modal slice on re-handshake

**Size:** S · **Security-sensitive:** no · **UI/Figma:** no (pure reducer + bridge; modal design locked at #122/#224) · Split from #196 (sibling #197 owns the `queue_state` reconnect reset).

## Files to read first

- `src/renderer/src/store/modalPrompts.ts:35-75` — the `ModalEvent` union (add the new arm here) and `ModalState` with its three slices `outstanding` / `rejections` / `resolved`. Extract: the reset coordinates exactly these three; only `outstanding` clears.
- `src/renderer/src/store/modalPrompts.ts:120-167` — `reduceModal`. Extract two idioms to mirror: the `shown` arm's `resolved`-first early-out (L122-125) — the "stays suppressed" behaviour the reset must preserve `resolved` to keep working; and the `dismissed`/`rejected`/`rejectionDismissed` **same-reference-on-no-change** returns (L147, L157, L162) — the pattern the new arm's empty-`outstanding` case must follow.
- `src/renderer/src/store/modalBridge.ts:41-104` — `translateModalEvent`. Extract: `connected` currently sits in the shared fall-through group (L62) that ends in `return null` (L100), guarded by `assertNever` (L102). The change moves `connected` to its own `return`; the guard stays intact only if `connected` is **removed** from the fall-through list.
- `src/renderer/src/store/modalBridge.test.ts:83-157` — the "every other arm returns null" test. **Load-bearing:** `{ type: 'connected', ack }` at **L87** is inside the `others` array asserting `null`. It must move OUT into a new positive assertion, or this test fails after the flip.
- `src/renderer/src/store/modalPrompts.test.ts:1-54` — fixture builders (`shown` / `dismissed` / `rejected` / `rejectionDismissed`) and the `run(events)` fold helper. Add a `reconnected()` builder in the same idiom; new reducer tests fold through `run`.
- `src/shared/ipc/events.ts:78` — the `connected` DaemonEvent is `{ type: 'connected'; ack: HelloAckPayload }`. Extract: the `ack` payload is **unused** by the reset; the bridge case ignores `event` entirely.
- `src/renderer/src/store/modalStore.ts:13-19` — `dispatch: (event: ModalEvent) => void`. Confirms adding a union arm is transparent to the store — no `modalStore.ts` change.
- `docs/specs/architecture/195-modal-reconcile-idempotency.md` (if present) — the idempotent `shown` match-and-replace + `resolved` slice this reset composes with.

## Context

The relay supervisor re-emits `connected` on every (re)connect; v2 has no session resume, so the transport re-handshakes there (`relaySupervisor.ts`, `daemonConnection.ts`). The already-typed `connected` daemon event reaches the renderer over the daemon-event channel today — but nothing resets the modal control-state across that boundary. So after a reconnect the modal store can hold a **stale outstanding prompt** the daemon already resolved (a frozen dialog the user can still try to answer), or miss a prompt raised while the connection was down.

The daemon now brings every fresh handshake to current control truth by re-sending its outstanding `modal_shown` prompts on connect (pyrycode#877, contract pyrycode#879). This ticket is the desktop's renderer-side application of that: on the re-handshake, **clear the `outstanding` slice, then let the daemon's connect-time re-sends repopulate it.** Absence after the handshake means resolved-while-away → stays cleared.

This composes with the merged idempotent keying (#195, `resolved` slice) and the rejection surface (#249, `rejections`). The reset **preserves both**: `resolved` so an optimistically-answered prompt stays suppressed even if the daemon re-sends it; `rejections` because it has no daemon repopulation path (clearing it would drop a banner with nothing to refill).

Entirely renderer-side: one new reducer arm + one bridge case flip. No transport change, no new preload surface, nothing new crosses the renderer boundary — the same surface as #195.

## Design

Two edits, both additive-in-spirit, no consumer cascade.

### 1. New `ModalEvent` union arm (`modalPrompts.ts`)

Add a bare, payload-free arm to the `ModalEvent` union (L35-55):

```ts
// The transport (re)connected. Fires on EVERY supervisor (re)handshake including the first connect.
// Reconciles `outstanding` against the daemon's connect-time re-sends by clearing it; the daemon then
// repopulates via `shown`, and absence = resolved-while-away. Carries no payload — the reset needs
// nothing from the connect ack. First-connect is the empty-`outstanding` no-op (AC4).
| { type: 'reconnected' }
```

**Name choice:** `reconnected` — one past-tense word, consistent with `shown` / `dismissed` / `rejected`. It fires on first connect too; the doc comment carries that nuance and the empty-`outstanding` early-out makes first-connect a same-reference no-op. Prescribed, not open — do not rename.

### 2. New `reduceModal` case (`modalPrompts.ts`)

Add before the `default: assertNever` arm. Contract: clear `outstanding`, spread through `rejections` + `resolved`, and return the **same state reference** when `outstanding` is already empty.

```ts
case 'reconnected': {
  if (state.outstanding.length === 0) return state   // AC4: no churn on first/held-nothing connect
  return { ...state, outstanding: [] }               // spread preserves `rejections` + `resolved`
}
```

- `{ ...state, outstanding: [] }` mints a fresh empty array (the selector *should* churn — we genuinely cleared prompts) while `rejections` and `resolved` pass through by reference untouched (AC3).
- The empty-`outstanding` guard mirrors `removeById`'s same-reference-on-no-change discipline (L88-90) and the `dismissed`/`rejected` `return state` idiom (AC4).
- **Do not touch `resolved`.** Preserving it is exactly what keeps the `shown` arm's `resolved`-first early-out (L125) suppressing an optimistically-answered prompt the daemon re-sends.

### 3. Bridge flip (`modalBridge.ts`)

Move `connected` out of the fall-through group (delete `case 'connected':` at L62) and give it its own return:

```ts
case 'connected':
  return { type: 'reconnected' }   // ignores event.ack (HelloAckPayload) — the reset needs nothing from it
```

The `assertNever` guard (L102) stays load-bearing: every `DaemonEvent` arm is still handled, so a future arm remains a compile error until each of the three bridges decides its mapping. This is the AC's "the bridge, which today maps `connected` to `null`, now translates it to the reset modal event."

### Data flow (unchanged path, one new arm at each end)

```
supervisor (re)handshake
  → daemonConnection.ts emits DaemonEvent{connected, ack}   (handshake-complete, before re-sends)
  → single in-order daemon-event channel
  → translateModalEvent(connected) → ModalEvent{reconnected}
  → modalStore.dispatch → reduceModal → outstanding: []
  → (then) daemon re-sends modal_shown → …{shown} → append fresh, exactly once
```

## State + concurrency model

- **Store:** the existing app-singleton `modalStore` (single source of state; `reduceModal` is the only writer). No new slice — the reset operates on the existing `outstanding` and preserves `rejections` + `resolved`.
- **Ordering is load-bearing and already satisfied — no seam.** The daemon emits `connected` at handshake-complete (`daemonConnection.ts`, ~L457) strictly before its inbound loop re-sends `modal_shown`. The renderer's single daemon-event channel delivers in arrival order (FIFO); `subscribeModal`'s listener translates + dispatches **synchronously** per event, and zustand `setState` completes before the next event is processed. So the reset's state update lands before any re-sent `shown` — reset-before-repopulate holds even if events arrive in separate ticks. **I found no reordering seam in the renderer path.**
- **"Exactly once" falls out of #195, no new logic:** after the reset, `outstanding` is empty, so a re-sent still-held prompt hits the `shown` arm's append branch once (no duplicate). "Stays suppressed" falls out of the `shown` arm's `resolved`-first early-out — which is why the reset must preserve `resolved`.
- **No teardown/cancellation surface added.** The `useModalBridge` effect lifecycle (subscribe on mount, off on cleanup, StrictMode-safe) is unchanged.

## Error handling

Minimal — no I/O, no async, no new failure mode. The reset reacts to an already-typed/decoded event.

- A `connected` with no subsequent re-sends → `outstanding` cleared and stays cleared (resolved-while-away, or nothing was held). Correct by the pyrycode#877/#879 contract: the daemon re-sends *all* still-outstanding prompts on connect, so absence is authoritative. Not this ticket's concern to defend against a daemon that violates the contract.
- The `reconnected` arm cannot throw: no lookups, no narrowing beyond the discriminant.

## Testing strategy

vitest at the bridge/store level — plain function tests on the pure reducer + pure translator, no React rendering. Add a `reconnected()` fixture builder to `modalPrompts.test.ts` in the existing idiom; fold sequences through the existing `run()` helper.

**Reducer (`modalPrompts.test.ts`):**
- Reset clears `outstanding`: fold `[shown('m1'), shown('m2'), reconnected]` → `outstanding` is `[]`.
- Reset preserves `resolved`: a prompt answered before the drop (`[shown('m1'), dismissed('m1'), reconnected]`) leaves `resolved` containing `m1` (assert `resolved` survives; ideally same reference).
- Reset preserves `rejections`: `[shown('m1'), rejected('r1'), reconnected]` leaves `rejections` `['r1']` (assert survives; ideally same reference).
- Empty-`outstanding` → **same reference**: from a state with `outstanding: []`, `reconnected` returns the identical `ModalState` object (`toBe`). Cover both first-connect (initial state) and reconnect-after-all-resolved.
- Exactly-once after reset: `[shown('m1'), reconnected, shown('m1')]` → `outstanding` has `m1` exactly once (length 1, fields from the re-send).
- Resolved-while-away stays cleared: `[shown('m1'), reconnected]` with no re-send → `outstanding` empty (this is the clears-case restated; keep it explicit as the AC2 anchor).
- Optimistically-answered stays suppressed across reset: `[shown('m1'), dismissed('m1'), reconnected, shown('m1')]` → `outstanding` stays empty (the `resolved`-first early-out fires because the reset preserved `resolved`).

**Bridge (`modalBridge.test.ts`):**
- **`connected` → `{ type: 'reconnected' }`** (new positive assertion). Remove `{ type: 'connected', ack }` from the `others` null-arm array at **L87** first — leaving it there makes the "returns null for every other arm" test fail.
- Sanity: at least one representative other transport-lifecycle arm (e.g. `disconnected`) still → `null`, confirming only `connected` was moved out.

## Open questions

None blocking. The end-to-end proof against a real fake-daemon reconnect (driving a real supervisor re-dial through the in-process harness) rides sibling #416, which depends on this ticket merging; #415 is self-contained and fully verifiable at the bridge/store level.
