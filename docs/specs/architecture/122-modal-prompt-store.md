# Spec #122 — Introduce the renderer-side modal-prompt store (pure model + reducer)

**Size:** S · **Security-sensitive:** no · **Figma:** N/A (pure data model, no rendering — the interactive render is the peeled follow-up)

Decision record: [ADR 0009](../../knowledge/decisions/0009-modal-prompt-model.md) — **read it first.** It fixes the type shapes, the id-addressing choice (ordered array, not a `Map`), the reduce semantics for hold / clear / unknown-id, and the Strangler-Fig coexistence. This spec is the implementation contract for that ADR. This ticket is the exact modal analog of #121 → [ADR 0008](../../knowledge/decisions/0008-thread-timeline-model.md): the pure model foundation, before the wire / transport / render vertical (the peeled follow-up) lands on it.

## Files to read first

- `docs/knowledge/decisions/0009-modal-prompt-model.md` — the model, every reducer arm's contract, and the rationale. The **Decision** and **Reduce behavior** sections are normative — do not add fields or arms beyond them.
- `src/renderer/src/store/threadTimeline.ts` (whole file, 162 lines) — **THE template.** Your module is the same shape for a different state (`outstanding: ModalPrompt[]` instead of `items` + `phase`). Copy exactly: sealed union on a discriminant, pure exported reducer with no `...state` spread, the inline `assertNever` guard (`:58-60`, reuse verbatim), the "return the same array/state reference when nothing changes" no-churn discipline (`fillResult` `:89-105`), the `initial…State` const, and pure selectors (`:160-161`).
- `src/renderer/src/store/threadTimeline.test.ts` (whole file, 192 lines) — **THE test idiom.** Mirror it: small fixture builders with sensible defaults (`delta`/`toolUse`), a `run(events)` fold helper over `initial…State`, one `describe` per behavior, and `toBe` reference-equality assertions for the no-op / purity cases. Your fixtures are `shown(...)` / `dismissed(...)`.
- `docs/knowledge/decisions/0008-thread-timeline-model.md` — the ADR #121 wrote; the reducer-behavior and Strangler-Fig sections carry over shape-for-shape. 0009 is its modal twin.
- `src/renderer/src/store/sessionStore.ts:34-172` — the original reducer template (sealed `SessionAction` union, `appendUnique`'s same-array-on-no-op). `threadTimeline` already distills it; consult only if you want the source pattern.
- `src/shared/wire/types.ts` — **confirm the modal wire types do NOT exist here** (`EnvelopeType` has no `modal_shown`/`modal_dismissed`, there is no `DaemonEvent` modal arm). You are **not** adding any. Your reducer's input is the renderer-local `ModalEvent` union, exactly as `threadTimeline` takes `ThreadEvent`.

## Context

When `claude` hits a permission/trust prompt in a desktop-driven interactive session, the daemon (once desktop advertises `interactive`, #179) will send a `modal_shown` frame and later a `modal_dismissed`. Desktop needs a single, testable source of truth for which prompt is currently outstanding. None of that machinery exists on `main`: no modal store, no modal wire types, no `DaemonEvent` arm.

This ticket introduces the **foundation slice**: the renderer-side modal-prompt model — **the pure model + reducer half only** — alongside the session store, migrating nothing. The wire types, transport decode, `DaemonEvent` arm, daemon-event bridge, render, and answer / cancel path are the peeled follow-up (blocked-by this ticket). Keeping the model id-addressed by `modalId` from the start makes #195 (match-and-replace) and #196 (reconnect reconcile) small extensions rather than refactors. See ADR 0009 for the full rationale and the wire contract it mirrors.

## Design

One new module `src/renderer/src/store/modalPrompts.ts` and its test. **No other file changes.** No Zustand store, no React hook, no wire types — those are the follow-up's (the `modalStore.ts` container name is reserved for it, mirroring `timelineStore.ts` #202).

### Types (the contract — do not add fields beyond these)

```ts
export type ModalClass = 'permission' | 'trust'

export interface ModalOption {
  id: string
  label: string
}

/** The held, outstanding prompt — what a `shown` event installs and a `dismissed` clears. */
export interface ModalPrompt {
  modalId: string
  class: ModalClass
  title: string
  prompt: string
  options: readonly ModalOption[]
  defaultOptionId: string
}

/** The renderer-local, sealed input union the reducer consumes (camelCase; NOT the wire types). */
export type ModalEvent =
  | { type: 'shown'; modalId: string; class: ModalClass; title: string; prompt: string; options: readonly ModalOption[]; defaultOptionId: string }
  // `outcome`/`source` are carried for the follow-up consumer but NOT consulted by the reduce
  // (only `modalId` drives the clear) — mirroring threadTimeline's carried-but-unused `seq`.
  | { type: 'dismissed'; modalId: string; outcome: string; source: 'remote' | 'local' | 'timeout' }

export interface ModalState {
  outstanding: readonly ModalPrompt[]
}
```

Notes on the shape (all normative in ADR 0009):

- **`class` is a legal reserved-word property**, kept for wire parity so the follow-up's bridge is a thin rename. Consume via `p.class` or `{ class: cls }` destructuring. Do not rename it.
- **`options` order is load-bearing** (array order is display/selection order); `defaultOptionId` references one of `options[].id`. The store holds them verbatim — it does not validate or reorder.
- **No `conversation_id`** — the wire carries none on a modal; `modalId` is the sole correlation key.
- **`source`'s union is inline**, not a named export — the follow-up names it if its bridge/render needs it. Keep the module at five exported types (`ModalClass`, `ModalOption`, `ModalPrompt`, `ModalEvent`, `ModalState`), matching #121's count.

### Reducer — `reduceModal(state: ModalState, event: ModalEvent): ModalState`

Pure, exported, no mutation, no `...state` spread, `switch` on `event.type` with an `assertNever` default (reuse `threadTimeline`'s inline guard verbatim). Each arm's behavior (normative in ADR 0009 § Reduce behavior):

- **`shown`** — append a fresh `ModalPrompt` built from the event's fields (drop `type`) to `outstanding`. Always a new state (a shown is always a change). A `shown` for an already-outstanding `modalId` (reconnect re-delivery) is **not** defended here — that is #195's match-and-replace; append is correct for first-delivery. (Mirrors `threadTimeline`'s plain-append `toolUse` arm.)
- **`dismissed`** — remove the `ModalPrompt` whose `modalId` matches; return `{ outstanding: <filtered> }`. If **no prompt matches** (unknown or already-dismissed id) → **return the same `state` reference unchanged** (deterministic, non-throwing no-op — AC4). Only `modalId` is consulted; `outcome`/`source` are ignored by the reduce. (Mirrors `threadTimeline`'s orphan-`toolResult` same-reference no-op.)

Keep the "remove by id, same-reference when nothing removed" as a small internal helper in the spirit of `fillResult` (a scan that returns the same array when no match) — do not export it.

Also export `initialModalState: ModalState = { outstanding: [] }` and the pure selector `selectOutstanding = (s: ModalState): readonly ModalPrompt[] => s.outstanding` (returns the slice by reference — the read surface, matching `selectItems`). A `selectModalById` / current-modal convenience selector is deferred to the follow-up render (add when it's needed, not before).

## State + concurrency model

None. This is a pure, synchronous, framework-free reducer over an in-memory value — no store, no async, no subscription, no teardown. The single active conversation is assumed (ADR 0004); `modalId` is the sole correlation key (no conversation scoping in this module). No React, no IPC, no transport imports in this module or its test (`node` test env, like `threadTimeline.test.ts`).

## Error handling

The one failure mode this ticket addresses is a **`dismissed` for an unknown `modalId`** — a `modal_dismissed` whose `modal_shown` was never installed (e.g. it fell before a reconnect replay cursor), or a double-dismiss race. Outcome: **deterministic no-op returning the same `state` reference** — never a throw, never a partial mutation. It is drop-and-document, not a recovery path: no placeholder prompt is synthesized (evidence-based — no such orphan is observed yet; the transport that would produce it does not exist). The `assertNever` default guards against an unhandled future `ModalEvent` arm at compile time and throws only on a genuinely impossible runtime value, matching `reduceTimeline` / `reduceSession`.

## Testing strategy

`src/renderer/src/store/modalPrompts.test.ts`, vitest, `node` env, `reduceModal` exercised directly against injected `ModalEvent` sequences (no store, no React) — mirror `threadTimeline.test.ts`'s structure with `shown(...)` / `dismissed(...)` fixture builders (sensible defaults, override only what a case asserts) and a `run(events)` fold helper. Cover, as bullet-pointed scenarios (write the code in the project idiom):

- **Install** — a single `shown` puts one `ModalPrompt` in `outstanding`, carrying `modalId`, `class`, `title`, `prompt`, `options` (in order), and `defaultOptionId` verbatim.
- **Multiple outstanding** — two `shown`s with distinct `modalId`s yield two prompts in arrival (oldest-first) order; `selectOutstanding` exposes both.
- **Clear by id** — a `dismissed` whose `modalId` matches an outstanding prompt removes exactly that one, leaving the others (assert the surviving `modalId`s).
- **Unknown-id no-op (AC4)** — a `dismissed` for a `modalId` not in `outstanding` returns the **same `state` reference** (`toBe`); the set is unchanged and nothing throws. Cover both the empty-state and the non-empty-but-no-match cases.
- **Options / default preserved** — a `shown` with ≥2 options round-trips `options` order and `defaultOptionId` into the held `ModalPrompt` unchanged (the store does not reorder or validate).
- **`dismissed` ignores `outcome`/`source`** — two `dismissed` events for the same outstanding id differing only in `outcome`/`source` both clear identically; the reduce keys only on `modalId`.
- **Purity** — a `shown`/`dismissed` call does not mutate the input `state`, its `outstanding` array, or any existing `ModalPrompt` (assert old references intact; new references where a change occurred).
- **Initial state + selector** — `initialModalState.outstanding` is `[]`; `selectOutstanding(state)` returns `state.outstanding` **by reference** (`toBe`).
- **Exhaustiveness** — a compile-time note: adding a `ModalEvent` arm without a case is a type error (the `assertNever` guard; no runtime test needed).

Type coverage rides `npm run typecheck` (the discriminated unions + `assertNever`). Build gate `npm run build` and `npm test` must stay green — they will, because nothing imports the module.

## Out of scope (do not touch)

- `sessionStore.ts`, `threadTimeline.ts`, and every existing store/component — untouched (Strangler Fig).
- The modal wire types (`src/shared/wire/`), transport decode, the `DaemonEvent` modal arm, and the daemon-event bridge (wire → `ModalEvent`) — all the peeled follow-up.
- Any Zustand store (`modalStore.ts`), singleton, React hook, or rendering of a `ModalPrompt`; the answer / cancel path; the destructive second-confirm; surfacing a rejected answer — all the peeled follow-up.
- Re-delivery match-and-replace / no-second-notification / answered-id no-op (#195); reconnect reconcile (#196).
- Do not migrate any consumer; nothing imports `modalPrompts` at the end of this ticket.

## Open questions (resolve in the follow-up / #195 / #196, not here)

- **Re-delivery of an already-outstanding `modalId`** — this ticket's `shown` plain-appends (fresh-id assumption). #195 makes it match-and-replace; the array's id-addressing keeps that a one-arm change.
- **Answered-id no-op** — a `shown` for an id already resolved should not re-install. Needs an answered-id memory this store deliberately does not carry yet (#195).
- **Surfacing a `dismissed` outcome** (a resolution toast from `outcome`/`source`) and a `selectCurrentModal` / `selectModalById` selector — add when the follow-up render needs them.
- **The destructive second-confirm** is a client-side UX policy on the answer path (no `destructive` wire class exists) — the follow-up's, not modeled here.
