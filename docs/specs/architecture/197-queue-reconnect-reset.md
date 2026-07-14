# #197 — Queue slice: apply the connect-time `queue_state` snapshot as replacement truth on reconnect

**Size:** S · **Security-sensitive:** no · **UI/Figma:** no (pure store + data-path; queue render is #294) · Split from #196 (sibling #415 owns the modal `outstanding` reconnect reset — this is the queue-store twin).

## Files to read first

- `src/renderer/src/store/queueStore.ts:38-71` — `QueueState` (`backlogs: ReadonlyMap<string, readonly QueuedItem[]>`), the `QueueStore` type, and `createQueueStore`'s single `setBacklog` setter (copy-on-write over the map). Extract: the reset is a **second** mutation added here; it clears the whole map, mirroring `setBacklog`'s copy-on-write discipline (never mutate `s.backlogs` in place).
- `src/renderer/src/store/queueStore.ts:78-98` — `EMPTY_BACKLOG` (stable empty ref), `selectBacklogFor` (per-conversation read, `?? EMPTY_BACKLOG`), and `selectBacklogs` (whole-map read, added by #293 *explicitly for #197*). Extract: after the reset, an absent key reads as `EMPTY_BACKLOG` — this is the "absent == empty" path (AC3), so clearing the map **is** clearing every backlog; no per-key eviction loop is needed.
- `src/renderer/src/store/queueBridge.ts:25-50` — `translateQueueState` (the pure `queueState`→`QueueSnapshot|null` filter, `default: null`) and `subscribeQueue`. Extract: the bridge is **reactive-only today and deliberately does NOT observe `connected`** (its header calls the connect-time snapshot "#197's concern, not this slice's"). #197 wires that edge here.
- `src/renderer/src/store/queueBridge.ts:62-73` — `QueueData`, the app-lifetime headless subscriber mounted in `App.tsx`. Extract: it passes `queueStore.getState().setBacklog` into `subscribeQueue`; #197 also passes the new reset. Its signature and mount are **unchanged** — `App.tsx` is not touched.
- `src/shared/ipc/events.ts:76-78` — `DaemonEvent` union; `connected` is `{ type: 'connected'; ack: HelloAckPayload }`. Extract: the `ack` is **unused** by the reset; the branch reads only the discriminant.
- `src/renderer/src/store/queueStore.test.ts:20-107` — the `createQueueStore()` isolated-instance idiom, the `QueuedItem` fixtures (`a`, `b`), the `selectBacklogFor`/`selectBacklogs` assertions, and the "keeps the setBacklog reference stable" test. Extract: the shape for the new reset tests (add a `resetBacklogs` twin of every relevant setter test).
- `src/renderer/src/store/queueBridge.test.ts:59-144` — the `fakeBridge()` capture-the-listener helper, the `subscribeQueue(bridge.onDaemonEvent, …)` call sites (7 of them), and the two real-store "seam" tests. Extract: the 7 call sites need the new third argument; the seam tests are the pattern for the three reconnect-outcome proofs.
- `docs/specs/architecture/415-reconnect-modal-reconcile.md` — the sibling reset this mirrors. Extract: same `connected`-edge trigger, same reset-then-repopulate flow, same "empty → same-reference no-op" discipline; the one structural difference is that queue is a **keyed map** cleared wholesale, not a flat list, and is wired through a **store setter + subscription branch** rather than a reducer arm (the queue store has no event union — #293 deliberately chose direct setters).

## Context

The relay supervisor re-emits `connected` on every (re)handshake — v2 has no session resume, so the transport re-handshakes there. On each fresh handshake the daemon brings the client to current truth by re-sending one `queue_state` snapshot **per non-empty conversation** (pyrycode/pyrycode#878, contract pyrycode/pyrycode#879). `queue_state` is a full per-conversation snapshot, so the client rule is **replace, never merge** — which #293 already implements in `setBacklog`.

But nothing resets the queue store across the reconnect boundary today. So a stale backlog can survive it two ways, both reconnect-recovery correctness bugs:

1. **A conversation that fully drained while away** — the daemon re-sends *no* snapshot for it (only non-empty conversations are re-sent), so the pre-drop backlog lingers and the user sees queued messages that already ran into claude.
2. **A message queued while away** — covered by `setBacklog`'s replacement truth once the snapshot arrives, but only if the boundary is handled at all.

This ticket is the queue twin of #415 (which clears the modal `outstanding` slice on the same edge). The pattern is identical: **react to the `connected` edge, clear the slice, let the daemon's connect-time re-sends repopulate through the existing #293 write path.** The one difference from #415: the queue slice is a **map keyed by `conversation_id`**, so the reset clears *every* conversation's backlog, not one flat list. Because an absent key reads as `EMPTY_BACKLOG` (AC3), clearing the whole map is exactly "every held backlog is now empty" — no per-key loop.

Entirely renderer store + data-path. It reacts to the already-typed `connected` and already-decoded `queueState` events — it never touches keys, sockets, Noise, or raw frames (the fail-closed `queue_state` decode is #292's). Same posture as #415.

## Design

Two production edits, both additive. No new exported type.

### 1. New store mutation `resetBacklogs` (`queueStore.ts`)

Add a second method to the `QueueStore` type and its implementation in `createQueueStore`. #293 deliberately used direct setters over a reducer because it had exactly one mutation; #197 adds the second — still two named setters, **not** a discriminated-union action set (that would be ceremony for two operations, and would cascade into the bridge and `QueueData`).

- **Type:** extend `QueueStore` (queueStore.ts:43-45) with `resetBacklogs: () => void`.
- **Contract:** clear the whole map to a fresh empty `Map`, returning the **same state reference** when the map is already empty (the first-connect / already-drained no-op, mirroring #415's `if (outstanding.length === 0) return state`).
- **Behavior sketch** (not the final code — the developer writes it in the store idiom):
  - `resetBacklogs: () => set((s) => (s.backlogs.size === 0 ? s : { backlogs: new Map() }))`
  - Returning `s` (the identical state object) on the empty case makes zustand's `Object.is` short-circuit fire → no listener notification, no re-render churn (the AC "untouched … reads identically" / first-connect no-op).
  - Returning `{ backlogs: new Map() }` on the non-empty case mints a fresh empty map (the selector *should* churn — we genuinely cleared backlogs). Copy-on-write like `setBacklog`; never mutate `s.backlogs` in place.
- **Reference stability:** `resetBacklogs` is defined once in the store initializer, so it is a stable reference across updates (the existing "keeps the setBacklog reference stable" invariant, twinned).

### 2. Wire the `connected` edge into the subscription (`queueBridge.ts`)

Keep `translateQueueState` **pure and unchanged** — it stays the `queueState`→snapshot filter (`default: null`). The reset is a *different* action (no snapshot to translate), so it does not belong inside the snapshot translator. Handle it as a branch in the single subscription listener, so `QueueData` keeps **one** app-lifetime listener (its stated invariant) and the transport's arrival-order guarantee makes reset-before-repopulate automatic.

- **Widen `subscribeQueue`** (queueBridge.ts:42) to take a third parameter, `resetBacklogs: () => void` (required — production always wires it; a required param documents that the subscription owns both the write and the reset).
- **Listener contract:** on each event, if `event.type === 'connected'` call `resetBacklogs()` and return; otherwise translate and, when non-null, `setBacklog` (the existing `snapshot !== null` guard, unchanged so an empty `queued: []` snapshot still writes). The `connected` branch reads only the discriminant — it ignores `event.ack`.
- **Update `QueueData`** (queueBridge.ts:62-73) to pass `() => queueStore.getState().resetBacklogs()` as the third argument, alongside the existing `setBacklog` closure. No other change to `QueueData`; its signature and `App.tsx` mount are untouched.

### Data flow (one new branch at each end)

```
supervisor (re)handshake
  → daemonConnection.ts emits DaemonEvent{connected, ack}   (handshake-complete, BEFORE re-sends)
  → single in-order daemon-event channel
  → subscribeQueue listener sees {connected} → resetBacklogs() → backlogs: new Map()
  → (then) daemon re-sends queue_state per non-empty conversation
  → subscribeQueue listener sees each {queueState} → setBacklog(snapshot) → per-key repopulate
```

Repopulation is **not new code** — it rides `setBacklog` unchanged, exactly as #415's repopulation rides the idempotent `shown` arm. A conversation the daemon does *not* re-send stays absent → reads `EMPTY_BACKLOG` (AC3).

## State + concurrency model

- **Store:** the existing app-singleton `queueStore` remains the single source of truth (`selectBacklogFor` / `selectBacklogs` are the only read paths; `setBacklog` + the new `resetBacklogs` are the only writers). No new slice, no new store.
- **Ordering is load-bearing and already satisfied — no seam to build.** `daemonConnection.ts` emits `connected` at handshake-complete strictly before its inbound loop re-sends `queue_state`; the renderer's single daemon-event channel delivers in arrival order (FIFO); `subscribeQueue`'s one listener translates + dispatches **synchronously** per event, and zustand `set` completes before the next event is processed. So the reset lands before any re-sent snapshot — reset-before-repopulate holds even across separate ticks. This is the exact guarantee #415 relies on; there is **no reordering logic in the renderer**.
- **Re-render correctness after reset:** `selectBacklogFor(id)` returns `undefined ?? EMPTY_BACKLOG` for any cleared key — a component watching a conversation that *had* a backlog re-renders to empty (correct, we cleared it); a component watching one that was *already* empty keeps the same `EMPTY_BACKLOG` reference → no churn. The empty-map no-op (`return s`) means first-connect / already-drained reconnects churn nothing at all.
- **No teardown/cancellation surface added.** `QueueData`'s subscribe-on-mount / off-on-cleanup lifecycle (StrictMode-safe, one live listener) is unchanged — the third argument rides the same effect.

## Error handling

Minimal — no I/O, no async, no new failure mode. The reset reacts to an already-typed/decoded event.

- A `connected` with no subsequent re-sends → the map is cleared and stays cleared (every conversation drained while away, or nothing was held). Authoritative by the pyrycode#878/#879 contract: the daemon re-sends *all* non-empty backlogs on connect, so absence is truth. Not this ticket's concern to defend against a daemon that violates the contract.
- `resetBacklogs` cannot throw (no lookups, no narrowing); the `connected` branch reads only the discriminant.

## Testing strategy

Store-level and seam-level vitest — plain function tests over isolated `createQueueStore()` instances and the injected-spy `subscribeQueue`, no React rendering. Self-verifiable exactly as #415 was; a fake-harness reconnect e2e is out of scope here (it would reuse the reconnect-capable harness #416 builds for the modal reconcile).

**Store (`queueStore.test.ts`) — the `resetBacklogs` setter directly:**
- Reset clears every held backlog: seed `c1=[a,b]` and `c2=[b]`, `resetBacklogs()` → `backlogs.size` is 0; `selectBacklogFor('c1')` and `selectBacklogFor('c2')` both read `[]` (via `EMPTY_BACKLOG`).
- Empty-map reset is a same-reference no-op: from initial state, `resetBacklogs()` returns the identical state (assert `store.getState()` is unchanged by reference, or `selectBacklogs(before) === selectBacklogs(after)`) — mirrors the first-connect / already-drained case.
- Reset then `setBacklog` repopulates one conversation (replacement truth unchanged, AC2): `resetBacklogs()`, then `setBacklog({conversationId:'c1', queued:[a]})` → `selectBacklogFor('c1')` reads `[a]`.
- `resetBacklogs` reference is stable across updates (twin of the existing `setBacklog`-stability test).

**Seam (`queueBridge.test.ts`) — the `connected` edge round-trips through the real store, proving the three AC4 reconnect outcomes:**
- **Wire the third argument:** the 7 existing `subscribeQueue(bridge.onDaemonEvent, …)` call sites gain the new reset argument (a `vi.fn()` where reset isn't under test, or `() => store.getState().resetBacklogs()` in the real-store seams). Mechanical, single file.
- New unit assertions on the branch: a `connected` event calls `resetBacklogs` exactly once and does **not** call `setBacklog`; a `queueState` event calls `setBacklog` and **not** `resetBacklogs`; an unrelated event calls neither.
- **(a) dequeued-while-away does not resurrect:** emit `queueState c1=[a,b]`; emit `connected`; emit the daemon's re-send `queueState c1=[b]` (`a` drained while away) → `selectBacklogFor('c1')` reads `[b]`, `a` gone. **And the strongest form (the stale-backlog bug this ticket exists for):** seed `c2=[b]`; emit `connected`; send **no** re-send for `c2` (it fully drained → not re-sent) → `selectBacklogFor('c2')` reads `[]` (absent == empty across the boundary).
- **(b) queued-while-away appears:** seed `c1=[a]`; emit `connected`; emit re-send `queueState c1=[a,b]` → `selectBacklogFor('c1')` reads `[a,b]`.
- **(c) untouched reads identically:** seed `c1=[a,b]`; emit `connected`; emit re-send identical `queueState c1=[a,b]` → `selectBacklogFor('c1')` reads `[a,b]` (content-equal via `toEqual`; note the array reference legitimately changes — it is the fresh re-sent snapshot — so assert content, not identity).

## Open questions

None blocking. The end-to-end proof against a real fake-daemon reconnect (driving a real supervisor re-dial) is deferred to the reconnect-capable harness (#416, built for the modal reconcile and reusable here); #197 is self-contained and fully verifiable at the store/seam level.
