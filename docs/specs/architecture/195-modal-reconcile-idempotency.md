# Spec #195 — Modal store: match-and-replace by `modalId` so a re-delivered prompt never double-shows

**Ticket:** pyrycode/pyrycode-desktop#195 · **Size:** XS · **Not** `security-sensitive` (renderer store state only) · **No UI, no wire-type, no daemon change.**

Reliability/correctness work. The reducer's `shown` arm currently **always appends**, so the daemon's reconcile-on-connect re-send (which re-delivers a still-outstanding prompt under its **original** `modalId` after a connection blip) would show the same prompt twice. This ticket makes the `shown` fold idempotent on `modalId` — the client half of the reconcile-on-connect contract (daemon: pyrycode/pyrycode#877; wire contract: pyrycode/pyrycode#879).

## Files to read first

- `src/renderer/src/store/modalPrompts.ts` (whole, 157 lines) — **the only production file to edit.** Extract: the `shown` arm (L113–128, always-appends — the seam), the `dismissed` arm (L129–134), the `ModalState` shape (L65–68), `initialModalState` (L150), and the three same-reference helpers `removeById`/`appendUnique`/`removeRejection` (L81–103). The whole file is the same-reference discipline you must preserve.
- `src/renderer/src/store/modalPrompts.test.ts` (whole) — **the test idiom to follow.** The `shown(modalId, overrides?)` / `dismissed(modalId, ...)` fixture builders (L14–39), the `run(events)` fold helper (L52–54), `toBe` for same-reference assertions (L96–107), `toEqual` for value. New regression tests are peers of these.
- `src/renderer/src/store/modalStore.ts:27-45` — confirms the Zustand wrapper spreads `...init` and re-exports selectors; adding a field to `ModalState`/`initialModalState` flows through `createModalStore` with **no store change**. Read to confirm, not to edit.
- `src/renderer/src/store/modalBridge.ts:41-104` — **unaffected; do not edit.** `translateModalEvent` maps `modalShown → {type:'shown'}` and `modalDismissed → {type:'dismissed'}` (a tag-rename filter). The reducer change is invisible to it. Read only to confirm the scope boundary.

The daemon-side wire contract (pyrycode/pyrycode#879, in the `pyrycode` repo — not readable from this worktree) spells out the client sub-rules this ticket implements; they are **inlined in § Design** below so you need not fetch them.

## Context

The daemon is gaining reconcile-on-connect (#877, merged in `pyrycode`): on every (re)connection it unicasts any still-outstanding permission/trust prompt with its **original** `modalId`, replaying no past control events. The client's job (per #879's AC2, "match-and-replace by stable id, applied idempotently on every connect") is three sub-rules:

1. a re-delivered `shown` for a **known** (still-outstanding) id **updates in place — never double-shows**;
2. a `shown` for an id the client has **already resolved** is a **no-op**;
3. (out of scope here — see Open questions) reset-on-reconnect for a fresh handshake.

The concrete race sub-rule 2 defends: the user answers a prompt, the answer is in flight, the link blips, the daemon hasn't yet processed the answer, so on reconnect it re-sends the (from-its-view still outstanding) modal — but the client already cleared it optimistically (#237). Without a resolved-id memory the client re-surfaces an answered prompt.

**Belt-and-suspenders, different fabric.** The one-time-nonce `answer_token` binding (#236, main-side transport) already makes a duplicate *answer* inert end-to-end — that is the transport-side double-**answer** guard, and the store never sees `answer_token`. This ticket adds the independent store-side double-**show** guard. Two guards, different layers, different fabric. This ticket removes the double-show only; it does not touch the answer path.

The `rejected` / `rejectionDismissed` surface (#249) is orthogonal and out of scope — untouched.

## Design

### State change — retain resolved ids

`ModalState` currently holds only `outstanding` and `rejections`; neither records a `modalId` after it leaves `outstanding`, so the reducer cannot tell **never-seen** (→ append) from **seen-then-resolved** (→ no-op). Add one field:

```
export interface ModalState {
  outstanding: readonly ModalPrompt[]
  rejections:  readonly string[]
  resolved:    readonly string[]   // NEW: modalIds that left `outstanding` via `dismissed`
}
```

and extend `initialModalState` to `{ outstanding: [], rejections: [], resolved: [] }`.

**Invariant:** `resolved` and the set of `outstanding` modalIds are **disjoint** — an id enters `resolved` only when it leaves `outstanding`, and once in `resolved` a `shown` no-ops so it never re-enters `outstanding`. **`modalId`s are one-time nonces** (never reused for a new prompt), so a retained resolved id is *never* legitimately re-shown — retention-forever is correct and needs no eviction. (Growth is bounded in practice — see Open questions.)

`resolved` is internal reducer bookkeeping: no selector, no consumer reads it. Do **not** add `selectResolved`.

### `shown` arm — replace always-append with a three-case decision

The arm still spreads `...state` (so the orthogonal `rejections`/`resolved` surfaces survive), but branches on `modalId` before installing. Decision table (check `resolved` first — the cheap reconnect-race early-out):

| Condition | Action | Return | AC |
|---|---|---|---|
| `modalId ∈ resolved` | no-op (already answered/dismissed) | **same `state` reference** (no selector churn) | AC3 |
| `modalId ∈ outstanding` | replace that entry in place | new `outstanding` array, **position + length preserved**, matching entry rebuilt from the event's fields | AC2 |
| else (never seen) | append | new `outstanding` array with the fresh prompt at the tail | AC1 |

The rebuilt prompt in case 2 uses the **re-delivered** fields (the same six-field literal the current append builds at L119–126) — "updates in place" means taking the latest fields, not preserving stale ones. In practice the fields are identical (same outstanding modal), but taking the re-send's values is the correct match-and-replace semantics.

Implementation guidance: keep it minimal — an inline `state.outstanding.map(p => p.modalId === event.modalId ? next : p)` for case 2 reads cleanly once the resolved-first guard has split the branch. If you prefer the file's named-helper idiom, a `replaceById(outstanding, prompt)` mirroring `removeById`'s shape is acceptable — but do not add same-reference logic to it (case 2 is always a real change; only case 3 returns the same reference, handled in the arm).

### `dismissed` arm — record the resolved id on a genuine removal

`dismissed` is the **single choke point** where a prompt leaves `outstanding` — the answer path (#237) and cancel both dispatch `dismissed` locally, and remote/timeout dismissals arrive as `dismissed` too. So recording resolved ids here covers "already answered **or** dismissed" (AC3) in one place. Contract:

- Compute `outstanding = removeById(state.outstanding, event.modalId)`.
- **Unknown id** (`outstanding === state.outstanding`, no match): return `state` unchanged — inert, non-throwing (AC4). **Do NOT touch `resolved`.** This is the ordering-edge guard: a `dismissed` for an id that was never outstanding must not poison `resolved`, or a later legitimate `shown` of that id would be wrongly suppressed (Technical Notes).
- **Genuine removal**: record via `appendUnique(state.resolved, event.modalId)` and return `{ ...state, outstanding, resolved }`.

Reuse `appendUnique` verbatim — it is a generic `readonly string[]` same-reference dedup op (defensive here; a double-dismiss can't re-record because the second `dismissed` hits the unknown-id branch).

### Unchanged (scope fence)

- `rejected` / `rejectionDismissed` arms (#249) — orthogonal, untouched.
- `removeById`, `removeRejection`, `assertNever`, `selectOutstanding`, `selectRejections` — untouched.
- `modalStore.ts`, `modalBridge.ts` — no change (the store spreads `...init`; the bridge only tag-renames).

### State + concurrency model

Pure synchronous reducer, no async, no IPC, no transport, no React. One Zustand store (`modalStore`); `dispatch` is the sole write path (unidirectional, per CLAUDE.md). The new field flows through the existing `createStore((set) => ({ ...init, dispatch }))` wiring with no factory change.

### Error handling

No new failure modes. Every arm is total (the `assertNever` exhaustiveness guard is retained). Unknown-id `shown`/`dismissed` are same-reference no-ops (non-throwing, existing discipline). Pure renderer state — no network, socket, or parse surface.

## Testing strategy

Add regression tests to `src/renderer/src/store/modalPrompts.test.ts`, following its idiom (`shown()`/`dismissed()` fixtures, `run()` fold, `toBe` for reference identity, `toEqual` for value). Cover the two cases the append-only reducer gets wrong (AC5) plus the ordering edge, as bullet-pointed scenarios (developer writes the bodies):

- **Re-delivery while outstanding is idempotent (AC2):** fold `[shown('m1'), shown('m2'), shown('m1')]` → `outstanding` still length 2, ids `['m1','m2']` (position preserved), no duplicate. Re-deliver `m1` with an override (e.g. `{ title: 'Updated' }`) and assert the in-place entry reflects the **re-delivered** field — proves match-and-replace takes the latest fields, not a duplicate append.
- **Re-delivery after resolution is a no-op (AC3):** fold `[shown('m1'), dismissed('m1')]` to a base state; then assert `reduceModal(base, shown('m1'))` **`toBe` base** (same reference — no re-append, no selector churn) and `base.outstanding` stays empty.
- **Answer path equals dismissal (AC3):** the answer path dispatches `dismissed` locally, so the scenario above covers it; add a one-line comment noting the equivalence rather than a separate transport test.
- **Ordering edge — dismiss-before-show does not permanently suppress (Technical Notes):** fold `[dismissed('ghost'), shown('ghost')]` → `outstanding` length 1 containing `ghost`. Proves the never-outstanding `dismissed` did **not** record `ghost` in `resolved`, so the later legitimate `shown` still installs.
- **First delivery unchanged (AC1):** the existing install/multiple-outstanding tests already assert this; confirm they still pass (a `shown` for an unknown, unresolved id appends verbatim).
- **Unknown-id `dismissed` still inert (AC4):** the existing same-reference no-op tests (L95–108) must still pass unchanged.
- **Purity under re-delivery:** a re-delivery-while-outstanding must not mutate the input state's `outstanding` array (mirror the existing purity tests, L133–158).
- **Initial state:** assert `initialModalState.resolved` is empty, mirroring the existing `outstanding`/`rejections` initial-state tests (L217–224).

All pre-existing tests (distinct-id append, dismissed-by-id, rejection surface, orthogonality, selectors) must remain green — this is an additive fold refinement, not a behavior change on any path the current tests exercise.

**Typecheck:** `npm run typecheck` — `resolved` is a **required** field on `ModalState`; verified there is no other raw-`ModalState` construction in the codebase (every `createModalStore()` call uses the default `initialModalState`), so the added field does not cascade. **Build gate:** `npm run build` and `npm test` green.

## Open questions

- **Unbounded `resolved` growth.** `resolved` accumulates every resolved `modalId` for the store's lifetime with no eviction. Deliberately not bounded: modals are human-gated and rare, the ids are short strings, and one-time nonces make retention *correct* (no false suppression is possible). Per Evidence-Based Fix Selection there is no observed growth problem to defend against; a ring-buffer cap would be speculative complexity on an XS ticket. Flagged so review knows the accumulation is intentional.
- **Reset-on-reconnect (out of scope).** #879's AC2 third sub-rule — a fresh Noise handshake resets client control state and rebuilds it from what the daemon re-asserts — is **not** this ticket. No connection event reaches this reducer (the `ModalEvent` union has no reset arm; connection state arrives as separate `DaemonEvent`s handled elsewhere). If a future ticket adds that reset, it will decide whether clearing `outstanding` on handshake also clears `resolved`; nothing here blocks that.
