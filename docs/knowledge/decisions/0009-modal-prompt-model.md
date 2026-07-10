# 0009 — Modal-prompt model: an id-addressed `ModalPrompt` set + pure reducer, alongside the session store

## Status

Accepted, 2026-07-10. First realized in [#122](../codebase/122.md). Foundation for the modal render / answer vertical (the peeled follow-up) and the reconnect / idempotency refinements ([#195](https://github.com/pyrycode/pyrycode-desktop/issues/195), [#196](https://github.com/pyrycode/pyrycode-desktop/issues/196)). This ADR is to modals what [0008](0008-thread-timeline-model.md) is to the timeline.

## Context

When `claude` surfaces a permission or trust prompt during a desktop-driven interactive session, the daemon — once desktop advertises the `interactive` capability (#179, deliberately withheld today) — sends a `modal_shown` frame, and later a `modal_dismissed`. The desktop must hold that prompt as current truth, surface it, and later clear it.

None of that machinery exists on `main`: no modal wire types, no `DaemonEvent` arm, no modal store. This ADR fixes the **first slice** — the renderer-side modal-prompt model, the **pure model + reducer half only** — exactly as [0008](0008-thread-timeline-model.md)/#121 introduced the `ThreadItem` timeline model before its wire / transport / render vertical (#199) landed on top. The same split applies: this is the pure store; the wire types, transport decode, `DaemonEvent` arm, daemon-event bridge, render, and answer / cancel path are the peeled follow-up (blocked-by this ticket).

The wire contract already exists on the daemon/mobile side (pyrycode `docs/protocol-mobile.md § Modal (v2)`, SSOT spec #701):

- `modal_shown{ modal_id, class, title, prompt, options: [{ id, label }], default_option_id }` — binary → phone. `options` is **ordered** (array order is display/selection order); `default_option_id` ∈ `options[].id` (a fail-safe deny default, decided daemon-side).
- `modal_dismissed{ modal_id, outcome, source }` — binary → phone. `outcome` = the answered option id or a producer sentinel; `source` ∈ the closed set `{ remote, local, timeout }`.

Two contract facts are load-bearing for this model:

- **`modal_id` is the sole correlation key.** It is a one-time, opaque, unguessable nonce minted per surfaced modal; **no `conversation_id` is carried on a modal** (the daemon hosts one active conversation and resolves `modal_id` against its own outstanding-modal state).
- **The shipped `class` set is `permission | trust` only.** There is **no `destructive` wire class** — "a destructive action needs a second confirm" is a client-side UX policy on the answer path (the follow-up), not a wire distinction; the contract carries no machine-readable destructiveness signal.

The open architect's-call questions this ADR settles: what member set the renderer-local modal-event union carries; what feeds the reducer when the wire types don't exist yet; how outstanding prompts are held and addressed; the reduce semantics for hold / clear / unknown-id; and where the resolution metadata lives.

## Decision

A new, **standalone, framework-free** module `src/renderer/src/store/modalPrompts.ts` introduces the modal-prompt model **alongside** `sessionStore`. It delivers only the **pure model + reducer half** — no Zustand store, no React hook, no wire types, no IPC — mirroring `threadTimeline.ts` piece-for-piece. (The Zustand container `modalStore.ts` that wraps `reduceModal` is the **follow-up's**, analogous to how `timelineStore.ts` (#202) wrapped `reduceTimeline`. That name is reserved for it; this pure model is named by its domain, not `…Store`, per the 0008 precedent.)

Its pieces:

- **`ModalClass`** — `'permission' | 'trust'`, the two shipped wire classes.
- **`ModalOption`** — `{ id: string; label: string }`, one ordered option.
- **`ModalPrompt`** — the held, outstanding prompt: `{ modalId; class; title; prompt; options: readonly ModalOption[]; defaultOptionId }`.
- **`ModalEvent`** — the renderer-local, sealed, camelCase input union:
  - `{ type: 'shown'; modalId; class; title; prompt; options: readonly ModalOption[]; defaultOptionId }`
  - `{ type: 'dismissed'; modalId; outcome: string; source: 'remote' | 'local' | 'timeout' }`
- **`ModalState`** — `{ outstanding: readonly ModalPrompt[] }`.

Plus a pure, exported **`reduceModal(state, event): ModalState`**, an `initialModalState` const, and a narrow pure selector `selectOutstanding` — the same discipline as `reduceSession` / `reduceTimeline`: no mutation, returns fresh state, `switch` on the sealed union with an `assertNever` exhaustiveness guard, same-reference return when nothing changes, unit-tested with no React and no store.

### id-addressing — `modalId` is the sole correlation key

Outstanding prompts are held in an **ordered array** `outstanding: readonly ModalPrompt[]` and correlated by `modalId` — the one-time nonce is the only key (no `conversation_id` exists on a modal). An array, **not** a `Map` / `Record`, because:

- it mirrors 0008's `items` array + scan-by-id correlation exactly (the `fillResult` / same-reference-on-no-op discipline);
- the selector returns the array **by reference**, giving the follow-up render referential stability — a `[...map.values()]` selector would allocate a fresh array on every call and churn React;
- insertion order is preserved for render (oldest-first) without leaning on `Record` key-order fragility.

`modalId` correlation over the array is what keeps #195 (match-and-replace) a **one-arm change** and #196 (reconnect reconcile) a **filter**, not a representation refactor. That is the "id-addressed from the start" property the ticket calls for — it lives in the correlation mechanism, not in the container type.

### The wire boundary — a renderer-local event union, not wire types

The modal wire types do not exist in desktop yet and are **out of scope here** (the follow-up's). So the reducer's input is a renderer-owned, camelCase, sealed `ModalEvent` union defined in this module — exactly as `sessionStore`'s `SessionAction` and 0008's `ThreadEvent`. When the follow-up lands the wire types and the transport bridge, that bridge maps wire (snake_case) → `ModalEvent` (`modal_id`→`modalId`, `default_option_id`→`defaultOptionId`, `options` pass through) — the desktop analog of `daemonEventBridge` mapping `DaemonEvent` → `SessionAction`. Field names/types here **mirror the wire so that bridge is a thin rename**. `conversation_id` is not carried because the **wire carries none** (contrast 0008, where the bridge *drops* a present `conversation_id`).

### Reduce behavior (the contract each arm honors)

- **`shown{modalId, class, title, prompt, options, defaultOptionId}`** — append a fresh `ModalPrompt` built from those fields to `outstanding`. First-delivery sees only fresh ids, so append is correct. A `shown` for an **already-outstanding `modalId`** (a reconnect re-delivery) is **not** defended here — that is #195's match-and-replace, a localized change to this one arm that the array's id-addressing already supports. Evidence-based: no re-delivery is even *received* yet (the transport doesn't exist), so building the dedup now would be a defense for an unobserved failure. This mirrors 0008's `toolUse` arm, which also plain-appends and leaves correlation to a later arm.
- **`dismissed{modalId, outcome, source}`** — remove the `ModalPrompt` whose `modalId` matches; return a new state. If **no prompt matches** (unknown or already-dismissed id) → return the **same `state` reference** unchanged (deterministic, non-throwing no-op, AC4). `outcome` and `source` are **carried on the event** for the follow-up consumer (a resolution toast) but are **not consulted by the reduce** — only `modalId` drives the clear — mirroring 0008's carried-but-unconsulted `seq`.

## Rationale

- **Ordered array + scan-by-id, not a Map** — referential stability for the follow-up selector, exact 0008 parity, and it keeps #195/#196 small (see § id-addressing). A keyed container buys O(1) lookup this store never needs (at most a handful of outstanding modals) at the cost of selector churn and a divergence from the sibling model.
- **`shown` appends; dedup deferred** — evidence-based restraint. #195 explicitly owns re-delivery idempotency / no-second-notification / answered-id no-op; the array's id-addressing makes that arm change a small extension rather than a refactor (the ticket's stated goal). Modeling it now would both duplicate #195's scope and defend an unobserved failure.
- **Remove-on-dismiss, same-reference no-op on unknown id** — the daemon `Resolve` retires an outstanding modal; the desktop mirrors by removing it. The unknown-id no-op absorbs a `modal_dismissed` whose `modal_shown` fell before a replay cursor, or a double-dismiss race, **without killing the store** — the exact drop-and-document posture 0008 took for an orphan `tool_result`.
- **`class` as a two-value union, no `destructive`** — the shipped wire class set is `permission | trust` only (#701 SSOT). The second-confirm-for-destructive-actions concern is a client-side UX policy on the answer path (the follow-up), not a wire distinction. Modeling `class` as exactly the two shipped values keeps the model honest and the follow-up unambiguous.
- **`outcome` / `source` carried on the event but unconsulted by the reduce** — the store holds only *outstanding* prompts; a resolved prompt is removed, so resolution metadata has no home in this *state*. Carrying it on the dismissed *event* gives the follow-up its target contract without the reducer growing a branch on it. `source` is a **pinned closed set** (fully determined by the resolution mechanism, #701); `outcome` is a **plain string** (option id or producer sentinel; the vocabulary is the producer's, documented not enforced — leaf-data convention).
- **`class` is a legal reserved-word property, kept for wire parity** — `{ class: 'permission' }` is valid; consumers read `p.class` or destructure `{ class: cls }`. Renaming to `modalClass` would break the thin-rename property for no safety gain.
- **Pure reducer + no store this ticket** — the AC exercises the model against injected sequences with no React/JSDOM; a pure `ModalState → ModalState` function does that with no store and no mocks. The Zustand container, singleton, diagnostics observer, and hook belong to the follow-up that renders modals. Shipping an unused store singleton now is speculative surface with no consumer.
- **Not security-sensitive** — a pure renderer reducer over already-typed, renderer-local events; no keys, sockets, wire bytes, or untrusted input (the same reasoning that left #121 unlabelled while #199 carried the label). The wire decode and answer-frame construction in the follow-up **are** security-sensitive and carry the label there.
- **Nothing to gate on in this store.** The `--allow-remote-permissions` grant is a daemon-side, per-device flag (`~/.pyry/<name>/devices.json`) — it is not on the wire and not in the desktop pairing record (`PairedServerRecord` holds only `server` / `relay` / `token` / `server_static_pubkey`). The desktop cannot self-gate; the follow-up renders and answers regardless, and an ungranted answer round-trips to an `error` envelope. Captured so the follow-up's answer-path architect scopes "surface the rejection," not "check a local bit / stay read-only."

## Consequences

- **The Strangler Fig is planted, nothing is cut over.** `sessionStore`, `threadTimeline`, and every existing store/component are **untouched**; no consumer imports `modalPrompts`. `npm run build` and `npm test` stay green because the module is standalone.
- **The follow-up splits along this ADR's seams.** The wire types + transport decode + `DaemonEvent` arm + daemon-event bridge (→ `ModalEvent`) + interactive render + answer / cancel path + destructive second-confirm all land on this stable model, exactly as #199 landed on 0008. The `ModalEvent` union is the stable target contract the bridge maps onto.
- **#195 and #196 are extensions, not refactors.** #195 (match-and-replace by `modal_id`, no-second-notification, answered-id no-op) changes the `shown` arm and adds an answered-id memory; #196 (reconnect reconcile) filters `outstanding` to a reconciled id set. Both are localized because the model is id-addressed from the start.
- **Deferred by design** (revisit in the follow-up / #195 / #196 when rendering): re-delivery match-and-replace and answered-id no-op (#195); reconnect reconcile (#196); surfacing a `dismissed` outcome as a toast; a `selectModalById` / `selectCurrentModal` convenience selector (add when the render needs it, not before); the destructive-second-confirm UX policy on the answer path. The sealed unions extend cleanly for each.

Related: [0008](0008-thread-timeline-model.md) (the timeline model this mirrors — pure model + reducer, renderer-local event union, same-reference no-op discipline, `…Store` container as the follow-up), [0004](0004-renderer-session-store-reducer-wire-types.md) (the `MessagePayload[]` store this coexists with and the pure-reducer template it follows), [0006](0006-ephemeral-screen-state-usereducer-not-store.md) (the pure-reducer discipline), [0002](0002-remote-head-over-relay-shared-wire.md) (the wire contract the follow-up's bridge mirrors). Contract SSOT: pyrycode `docs/protocol-mobile.md § Modal (v2)`, spec #701.
