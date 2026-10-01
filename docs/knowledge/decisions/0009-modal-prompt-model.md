# 0009 — Modal-prompt model: an id-addressed `ModalPrompt` set + pure reducer, alongside the session store

## Status

Accepted, 2026-07-10. First realized in [#122](../codebase/122.md). Foundation for the modal render / answer vertical (the peeled follow-up) and the reconnect / idempotency refinements ([#195](https://github.com/pyrycode/pyrycode-desktop/issues/195), [#196](https://github.com/pyrycode/pyrycode-desktop/issues/196)). This ADR is to modals what [0008](0008-thread-timeline-model.md) is to the timeline.

Amended 2026-09-01 ([#870](../codebase/870.md), [#871](../codebase/871.md), [#877](../codebase/877.md)): two premises in § Context were retired by pyrycode#1065 (`modal_shown` gained an outbound-scoping `conversation_id`, now carried onto `ModalEvent` itself as of #877). § Decision, § Rationale, and § Consequences are unaffected and stand as written — see the inline notes below.

Amended again 2026-09-01 ([#878](https://github.com/pyrycode/pyrycode-desktop/issues/878)): the id's journey no longer stops at `reduceModal`. It now rides onto the held `ModalPrompt` and is read by `selectHasOutstandingFor`, a new selector factory. See the inline notes in § The wire boundary and § Reduce behavior below.

Amended 2026-10-01 ([#1696](https://github.com/pyrycode/pyrycode-desktop/issues/1696)): state and reducer references below now include chat-owned resolution feedback and its identity-guarded local lifecycle. `source` selects remote/timeout notices; `outcome` remains unused. The initial rollout context and unamended rollout notes are historical.

## Context

When `claude` surfaces a permission or trust prompt during a desktop-driven interactive session, the daemon — once desktop advertises the `interactive` capability (#179, deliberately withheld today) — sends a `modal_shown` frame, and later a `modal_dismissed`. The desktop must hold that prompt as current truth, surface it, and later clear it.

None of that machinery exists on `main`: no modal wire types, no `DaemonEvent` arm, no modal store. This ADR fixes the **first slice** — the renderer-side modal-prompt model, the **pure model + reducer half only** — exactly as [0008](0008-thread-timeline-model.md)/#121 introduced the `ThreadItem` timeline model before its wire / transport / render vertical (#199) landed on top. The same split applies: this is the pure store; the wire types, transport decode, `DaemonEvent` arm, daemon-event bridge, render, and answer / cancel path are the peeled follow-up (blocked-by this ticket).

The wire contract already exists on the daemon/mobile side (pyrycode `docs/protocol-mobile.md § Modal (v2)`, SSOT spec #701):

- `modal_shown{ modal_id, class, title, prompt, options: [{ id, label }], default_option_id }` — binary → phone. `options` is **ordered** (array order is display/selection order); `default_option_id` ∈ `options[].id` (a fail-safe deny default, decided daemon-side).
- `modal_dismissed{ modal_id, outcome, source }` — binary → phone. `outcome` = the answered option id or a producer sentinel; `source` ∈ the closed set `{ remote, local, timeout }`.

Two contract facts are load-bearing for this model:

- **`modal_id` is the sole correlation key.** It is a one-time, opaque, unguessable nonce minted per surfaced modal, and the daemon resolves an answer against its own outstanding-modal state by `modal_id` alone. (At the time this ADR was accepted, `modal_shown` also carried no `conversation_id`; pyrycode#1065, merged 2026-07-17, added one as an **outbound display-scoping key** — desktop#870 mirrored it into the wire decode. It does not change this bullet: a client still cannot assert which conversation an *answer* targets, since `modal_answer`/`modal_cancel` carry no `conversation_id`. Amended 2026-09-01.)
- **The shipped `class` set is `permission | trust` only.** There is **no `destructive` wire class** — "a destructive action needs a second confirm" is a client-side UX policy on the answer path (the follow-up), not a wire distinction; the contract carries no machine-readable destructiveness signal.

The open architect's-call questions this ADR settles: what member set the renderer-local modal-event union carries; what feeds the reducer when the wire types don't exist yet; how outstanding prompts are held and addressed; the reduce semantics for hold / clear / unknown-id; and where the resolution metadata lives.

## Decision

A new, **standalone, framework-free** module `src/renderer/src/store/modalPrompts.ts` introduces the modal-prompt model **alongside** `sessionStore`. It delivers only the **pure model + reducer half** — no Zustand store, no React hook, no wire types, no IPC — mirroring `threadTimeline.ts` piece-for-piece. (The Zustand container `modalStore.ts` that wraps `reduceModal` is the **follow-up's**, analogous to how `timelineStore.ts` (#202) wrapped `reduceTimeline`. That name is reserved for it; this pure model is named by its domain, not `…Store`, per the 0008 precedent.)

Its pieces:

- **`ModalClass`** — `'permission' | 'trust'`, the two shipped wire classes.
- **`ModalOption`** — `{ id: string; label: string }`, one ordered option.
- **`ModalPrompt`** — the held, outstanding prompt: `{ conversationId; modalId; class; title; prompt; options: readonly ModalOption[]; defaultOptionId }`.
- **`ModalEvent`** — the renderer-local, sealed, camelCase input union:
  - `{ type: 'shown'; conversationId; modalId; class; title; prompt; options: readonly ModalOption[]; defaultOptionId }`
  - `{ type: 'dismissed'; modalId; outcome: string; source: 'remote' | 'local' | 'timeout' }`
  - Local-only `rejectionDismissed{modalId}`, `resolutionDisplayed{resolution}` and `resolutionDismissed{resolution}`.
  - `rejected{modalId}`, server-scoped `reconnected{conversationIds}` and pairing-boundary `reset`.
- **`ResolvedModal`** — `{ conversationId: string; modalId: string }`, the suppression and rejection-owner record shape.
- **`ModalResolution`** — `{ conversationId: string; kind: 'remote' | 'timeout'; phase: 'pending' | 'displayed' }`.
- **`ModalState`** — `{ outstanding: readonly ModalPrompt[]; rejections: readonly string[]; rejectionOwners: readonly ResolvedModal[]; resolved: readonly ResolvedModal[]; resolutions: readonly ModalResolution[] }`. `initialModalState` has empty arrays for all five slices. Feedback is transient and is never persisted.

Plus a pure, exported **`reduceModal(state, event): ModalState`**, an `initialModalState` const, and a narrow pure selector `selectOutstanding` — the same discipline as `reduceSession` / `reduceTimeline`: no mutation, returns fresh state, `switch` on the sealed union with an `assertNever` exhaustiveness guard, same-reference return when nothing changes, unit-tested with no React and no store.

### id-addressing — `modalId` is the sole correlation key

Outstanding prompts are held in an **ordered array** `outstanding: readonly ModalPrompt[]` and correlated by `modalId` — the one-time nonce is the sole key for *answering* a prompt. An array, **not** a `Map` / `Record`, because:

- it mirrors 0008's `items` array + scan-by-id correlation exactly (the `fillResult` / same-reference-on-no-op discipline);
- the selector returns the array **by reference**, giving the follow-up render referential stability — a `[...map.values()]` selector would allocate a fresh array on every call and churn React;
- insertion order is preserved for render (oldest-first) without leaning on `Record` key-order fragility.

`modalId` correlation over the array is what keeps #195 (match-and-replace) a **one-arm change** and #196 (reconnect reconcile) a **filter**, not a representation refactor. That is the "id-addressed from the start" property the ticket calls for — it lives in the correlation mechanism, not in the container type.

### The wire boundary — a renderer-local event union, not wire types

The modal wire types do not exist in desktop yet and are **out of scope here** (the follow-up's). So the reducer's input is a renderer-owned, camelCase, sealed `ModalEvent` union defined in this module — exactly as `sessionStore`'s `SessionAction` and 0008's `ThreadEvent`. When the follow-up lands the wire types and the transport bridge, that bridge maps wire (snake_case) → `ModalEvent` (`modal_id`→`modalId`, `default_option_id`→`defaultOptionId`, `options` pass through) — the desktop analog of `daemonEventBridge` mapping `DaemonEvent` → `SessionAction`. Field names/types here **mirror the wire so that bridge is a thin rename**. `conversation_id` now rides the full chain: the wire's `modal_shown` carries a daemon-asserted `conversation_id` (pyrycode#1065), decoded into `ModalShownPayload` ([#870](../codebase/870.md)), carried onto the `modalShown` `DaemonEvent` arm by name ([#871](../codebase/871.md)), carried onto `ModalEvent`'s `shown` arm by name ([#877](../codebase/877.md)), and — as of [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) — copied by name a hop further onto the held `ModalPrompt` itself, where `selectHasOutstandingFor(conversationId)` reads it. It does not change id-addressing: `modalId` remains the sole correlation key for *answering* — `modal_answer`/`modal_cancel` still carry no `conversation_id`. Amended 2026-09-01, amended again 2026-09-01 for #878; see [inbound message decode](../features/inbound-message-decode.md) for the decode-site detail and [modal-prompt model](../features/modal-prompt-model.md) for the current `ModalEvent`/`ModalPrompt` shape.

### Reduce behavior (the contract each arm honors)

- **`shown`** — builds a fresh prompt including `conversationId` and optional context. An ID in `resolved` is a same-reference no-op; an outstanding ID is replaced in place; otherwise append. See the [model reference](../features/modal-prompt-model.md#types) for the full field set.
- **`dismissed{modalId, outcome, source}`** — first find the matching outstanding prompt. Unknown/already-removed IDs return the same state without touching suppression or feedback. A match is removed and its `{ conversationId, modalId }` appended to `resolved`. Only explicit `remote`/`timeout` sources install a pending `ModalResolution`, copying ownership from that held prompt and replacing the same chat's prior notice. Local/other sources create no notice; `outcome` is unused. A later daemon dismissal after optimistic local answer/cancel finds no held prompt and stays silent.
- **`resolutionDisplayed{resolution}`** — local-only, requires the exact held pending object; replaces it with a fresh displayed object. Copied, stale or already-displayed objects are same-reference no-ops.
- **`resolutionDismissed{resolution}`** — local-only, removes only the exact held object. An old timer or cleanup cannot remove a replacement, even for the same chat, copy or reused modal nonce.
- **`rejected` / `rejectionDismissed`** — retain or remove rejection feedback and its independent owner; see the [model contract](../features/modal-prompt-model.md#the-reducer).
- **`reconnected{conversationIds}`** — clears only the reconnecting server's `outstanding` and `resolved` records. Preserves rejection ownership and pending/displayed `resolutions` by reference; clearing a prompt never manufactures a notice.
- **`reset`** — returns `initialModalState` by reference, clearing all five slices across the pairing boundary.

## Rationale

- **Ordered array + scan-by-id, not a Map** — referential stability for the follow-up selector, exact 0008 parity, and it keeps #195/#196 small (see § id-addressing). A keyed container buys O(1) lookup this store never needs (at most a handful of outstanding modals) at the cost of selector churn and a divergence from the sibling model.
- **Id-addressing supports re-delivery without a representation refactor** — #195 extended `shown` with match-and-replace and suppression checks while keeping the ordered array.
- **Remove-on-dismiss, same-reference no-op on unknown id** — the daemon `Resolve` retires an outstanding modal; the desktop mirrors by removing it. The unknown-id no-op absorbs a `modal_dismissed` whose `modal_shown` fell before a replay cursor, or a double-dismiss race, **without killing the store** — the exact drop-and-document posture 0008 took for an orphan `tool_result`.
- **`class` as a two-value union, no `destructive`** — the shipped wire class set is `permission | trust` only (#701 SSOT). The second-confirm-for-destructive-actions concern is a client-side UX policy on the answer path (the follow-up), not a wire distinction. Modeling `class` as exactly the two shipped values keeps the model honest and the follow-up unambiguous.
- **Client-selected feedback with held ownership** — dismissal identifies a modal, not a chat; its held prompt supplies the owner. Only `remote` and `timeout` select notice kinds, without retaining outcome, prompt text or raw source. Falling back to suppression records would incorrectly notify for locally answered prompts. Feedback must outlive reconnect-scoped `resolved` independently.
- **Object identity for local lifecycle** — a chat ID, modal nonce or unchanged copy cannot distinguish generations. Identity makes stale display, expiry and cleanup events no-ops. The [Top overlay](../features/conversation-shell.md#permission-resolution-notices) starts four seconds on display, consumes shown feedback on navigation and leaves closed-chat notices pending.
- **`class` is a legal reserved-word property, kept for wire parity** — `{ class: 'permission' }` is valid; consumers read `p.class` or destructure `{ class: cls }`. Renaming to `modalClass` would break the thin-rename property for no safety gain.
- **Pure reducer + no store this ticket** — the AC exercises the model against injected sequences with no React/JSDOM; a pure `ModalState → ModalState` function does that with no store and no mocks. The Zustand container, singleton, diagnostics observer, and hook belong to the follow-up that renders modals. Shipping an unused store singleton now is speculative surface with no consumer.
- **Not security-sensitive** — a pure renderer reducer over already-typed, renderer-local events; no keys, sockets, wire bytes, or untrusted input (the same reasoning that left #121 unlabelled while #199 carried the label). The wire decode and answer-frame construction in the follow-up **are** security-sensitive and carry the label there.
- **Nothing to gate on in this store.** The `--allow-remote-permissions` grant is a daemon-side, per-device flag (`~/.pyry/<name>/devices.json`) — it is not on the wire and not in the desktop pairing record (`PairedServerRecord` holds only `server` / `relay` / `token` / `server_static_pubkey`). The desktop cannot self-gate; the follow-up renders and answers regardless, and an ungranted answer round-trips to an `error` envelope. Captured so the follow-up's answer-path architect scopes "surface the rejection," not "check a local bit / stay read-only."

## Consequences

- **The Strangler Fig is planted, nothing is cut over.** `sessionStore`, `threadTimeline`, and every existing store/component are **untouched**; no consumer imports `modalPrompts`. `npm run build` and `npm test` stay green because the module is standalone.
- **The follow-up splits along this ADR's seams.** The wire types + transport decode + `DaemonEvent` arm + daemon-event bridge (→ `ModalEvent`) + interactive render + answer / cancel path + destructive second-confirm all land on this stable model, exactly as #199 landed on 0008. The `ModalEvent` union is the stable target contract the bridge maps onto.
- **#195 and #196 are extensions, not refactors.** [#195](../codebase/195.md) (shipped) changed only the `shown` arm and added a `resolved: readonly string[]` field for answered-id memory — no representation refactor, confirming the prediction. #196 (reconnect reconcile) filters `outstanding` to a reconciled id set and remains open. Both are localized because the model is id-addressed from the start.
- **Originally deferred** to the render/answer follow-up: reconnect reconcile (#196); resolution feedback (now shipped for remote/timeout only; outcome stays unused); a `selectModalById` / `selectCurrentModal` convenience selector (add when the render needs it, not before); the destructive-second-confirm UX policy on the answer path. Re-delivery match-and-replace and answered-id no-op shipped in [#195](../codebase/195.md). The sealed unions extend cleanly for each.

Related: [0008](0008-thread-timeline-model.md) (the timeline model this mirrors — pure model + reducer, renderer-local event union, same-reference no-op discipline, `…Store` container as the follow-up), [0004](0004-renderer-session-store-reducer-wire-types.md) (the `MessagePayload[]` store this coexists with and the pure-reducer template it follows), [0006](0006-ephemeral-screen-state-usereducer-not-store.md) (the pure-reducer discipline), [0002](0002-remote-head-over-relay-shared-wire.md) (the wire contract the follow-up's bridge mirrors). Contract SSOT: pyrycode `docs/protocol-mobile.md § Modal (v2)`, spec #701.
