# Modal-prompt model

An id-addressed, ordered data model for the permission/trust prompts `claude` raises during a
desktop-driven interactive session — the foundation the modal render / answer vertical builds on.
Introduced **alongside** [session store](session-store.md) and [thread timeline](thread-timeline.md)
as a Strangler Fig: nothing cuts over, no consumer imports it yet.

Introduced in [#122](../codebase/122.md). Lives at `src/renderer/src/store/modalPrompts.ts`. Pure
renderer state — no IPC, no preload bridge, no transport, no React, no wire types. See
[ADR 0009](../decisions/0009-modal-prompt-model.md) for the full rationale and normative reducer
contract; this is the exact modal analog of [ADR 0008](../decisions/0008-thread-timeline-model.md) /
[#121](../codebase/121.md)'s timeline model.

[#223](../codebase/223.md) (shipped) added the [Zustand store + the `DaemonEvent → ModalEvent`
bridge](modal-store-bridge.md) wrapping `reduceModal` — this module's `ModalEvent` union is the target
contract that bridge maps onto. This module itself remains untouched; no wire-type import, no IPC,
still no React.

## What it does

When `claude` hits a permission or trust prompt in a desktop-driven interactive session, the daemon
(once desktop advertises the `interactive` capability, #179) sends a `modal_shown` frame and later a
`modal_dismissed`. Desktop needs a single, testable source of truth for which prompt is currently
outstanding. This module models that as a pure, unit-tested value type + reducer — nothing more.
There is no Zustand store, no singleton, no React hook, no wire types here; that render-integration
layer (plus the wire decode) is the peeled follow-up's.

## How it works

### Types

```ts
type ModalClass = 'permission' | 'trust'

interface ModalOption { id: string; label: string }

interface ModalPrompt {
  modalId: string
  class: ModalClass
  title: string
  prompt: string
  options: readonly ModalOption[]
  defaultOptionId: string
}

type ModalEvent =
  | { type: 'shown'; modalId: string; class: ModalClass; title: string; prompt: string; options: readonly ModalOption[]; defaultOptionId: string }
  | { type: 'dismissed'; modalId: string; outcome: string; source: 'remote' | 'local' | 'timeout' }
  // #249: a modal answer that round-tripped to a daemon `error`. Produced by the bridge from the
  // content-free `modalAnswerRejected` daemon event (#248) — carries ONLY the `modalId` nonce.
  | { type: 'rejected'; modalId: string }
  // #249: a LOCAL user action — dismissing a rejection banner. Never produced by the bridge.
  | { type: 'rejectionDismissed'; modalId: string }

interface ModalState {
  outstanding: readonly ModalPrompt[]
  rejections: readonly string[]   // #249: modalIds of round-tripped rejections, arrival order, deduped
  resolved: readonly string[]     // #195: modalIds that left `outstanding` via `dismissed` — internal
                                   // bookkeeping only, no selector, retained forever (modalIds are
                                   // one-time nonces, never reused)
}
```

`ModalPrompt` is the durable, held content; `ModalEvent` is the renderer-local (camelCase,
`conversation_id`-free) input the reducer consumes — the wire types don't exist yet, so this union
is the stable target contract the follow-up's bridge maps onto (wire `modal_id` → `modalId`,
`default_option_id` → `defaultOptionId`, thin rename). **There is no `destructive` wire class** —
the shipped `class` set is `permission | trust` only; a destructive second-confirm is a client-side
UX policy on the answer path, not a wire distinction.

`outstanding` is an **ordered array**, not a `Map`/`Record`, correlated by `modalId` (the sole
correlation key — no `conversation_id` exists on a modal). This mirrors `ThreadItem`'s array +
scan-by-id shape exactly: the selector returns the array by reference (referential stability for a
future render), and insertion order survives without leaning on `Record` key ordering.

`rejections` ([#249](../codebase/249.md)) is **orthogonal** to `outstanding` — the answered prompt is
already gone by the time a rejection can round-trip (#237's optimistic clear), so a rejection is new UI
state, never a re-surfaced prompt. It holds bare `modalId` strings, not objects: the `rejected` event is
content-free, so there is genuinely nothing else to carry (unlike `dismissed`'s `outcome`/`source`,
which mirror wire fields). Each id doubles as the stable React key when more than one rejection banner
shows.

### The reducer

`reduceModal(state, event): ModalState` is pure and exported — no mutation, fresh state, `switch`
on `event.type` with an `assertNever` default — the same discipline as `reduceSession` /
`reduceTimeline`:

| event | effect |
|---|---|
| `shown` | idempotent on `modalId` ([#195](../codebase/195.md)), checked in this order: (1) `modalId ∈ resolved` → **same `state` reference**, a no-op (already answered/dismissed — the reconnect-race early-out); (2) `modalId ∈ outstanding` → replace that entry in place with the fresh `ModalPrompt` built from the **re-delivered** fields (match-and-replace takes the latest values), position and length preserved, no duplicate; (3) else → append, exactly as first-delivery always did. Always spreads `state` so `rejections`/`resolved` survive. |
| `dismissed` | remove the `ModalPrompt` whose `modalId` matches (spreads `state` so `rejections` survives). No match (unknown or already-dismissed id) → **same `state` reference**, a deterministic non-throwing no-op (AC4) — and does **not** touch `resolved`, the ordering-edge guard ([#195](../codebase/195.md)): a `dismissed` for a never-outstanding id must not poison `resolved`, or a later legitimate `shown` of that id would be wrongly suppressed. A genuine removal also records the id into `resolved` via `appendUnique` — `dismissed` is the single choke point a prompt leaves `outstanding` through (answer/cancel/remote/timeout all dispatch it), so this one arm covers "already answered or dismissed." `outcome`/`source` are carried on the event but not consulted by the reduce — only `modalId` drives the clear. |
| `rejected` ([#249](../codebase/249.md)) | append `modalId` to `rejections`, de-duplicated (`appendUnique`). Repeat id → **same `state` reference** (no churn); `outstanding` is untouched. |
| `rejectionDismissed` ([#249](../codebase/249.md)) | remove `modalId` from `rejections` (`removeRejection`). Unknown/already-dismissed id → **same `state` reference**, a non-throwing no-op; `outstanding` is untouched. |

Note that `shown`/`dismissed` originally built their return value as `{ outstanding: … }` — #249 changed
both to `{ ...state, outstanding: … }` so they stop silently dropping the (then-new) `rejections` field;
any future field added to `ModalState` needs the same audit of every non-spreading reduce arm. [#195](../codebase/195.md)
confirmed the audit still held when it added `resolved`: both arms already spread `state`.

`initialModalState = { outstanding: [], rejections: [], resolved: [] }`; `selectOutstanding` and
`selectRejections` are the two read surfaces, each returning its slice by reference. `resolved` has no
selector — it is internal reducer bookkeeping only, never read outside `reduceModal` itself.

### Internal helpers (unexported)

- `removeById(outstanding, modalId)` — filters by `modalId`, returning the **same array reference**
  when nothing was removed, so `dismissed` can return the same `state` on an unknown id. Mirrors
  `threadTimeline`'s `fillResult` same-reference-on-no-match discipline.
- `appendUnique(rejections, modalId)` ([#249](../codebase/249.md)) — appends if absent, else returns the
  **same array reference** (defends #248's FIFO window redelivering an id in a race). Mirrors
  `removeById`'s same-reference-on-no-change contract for the append direction.
- `removeRejection(rejections, modalId)` ([#249](../codebase/249.md)) — `removeById`'s twin over
  `readonly string[]`.
- `assertNever(event)` — the compile-time exhaustiveness guard, reused verbatim from
  `threadTimeline`.

`appendUnique` ([#249](../codebase/249.md)) is also reused verbatim by `dismissed`
([#195](../codebase/195.md)) to record a resolved id — a generic `readonly string[]` same-reference
dedup op, not rejection-specific despite its origin.

## Configuration and usage

Nothing imports this module yet. The vertical is decomposed into six slices (ADR 0009); the first has
landed:

- **[#201](../codebase/201.md) (shipped)** — the modal wire types (`ModalShownPayload`/
  `ModalDismissedPayload`/`WireModalOption`/`WireModalClass`/`WireModalSource`) and the fail-closed
  transport decode, plus the `modalShown`/`modalDismissed` `DaemonEvent` arms. Field names/types
  mirror this module's `ModalEvent` so the next slice's bridge is a thin snake→camel rename. **Both**
  existing renderer bridges (session, timeline) discard the two arms as `null` — see [Daemon-event
  channel](daemon-event-channel.md) / [Daemon-event bridge](daemon-event-bridge.md) / [Conversation
  timeline store](conversation-timeline-store.md). This module itself is **untouched** by #201 — it
  still has no wire-type import, no IPC, no consumer.
- **[#223](../codebase/223.md) (shipped)** — the [modal store + bridge](modal-store-bridge.md) that
  maps the two arms onto `ModalEvent` and dispatches into `modalStore.ts`, a Zustand container
  wrapping `reduceModal` — the consumer this module's `ModalEvent` union has been the stable target
  contract for since #122.
- **[#224](../codebase/224.md) (shipped)** — the interactive render of an outstanding `ModalPrompt`
  (mounts `useModalBridge`, new `PermissionModal.tsx`), read-only inert buttons.
- the answer/cancel path, split 3-way from #225 by transport/render layer:
  **[#235](../codebase/235.md) (shipped)** — the [outbound wire types + fail-closed
  builders](modal-resolution-envelope.md) (`modal_answer`/`modal_cancel`), no consumer yet;
  [#236](https://github.com/pyrycode/pyrycode-desktop/issues/236) — main-command wiring, mints
  `answer_token`; [#237](https://github.com/pyrycode/pyrycode-desktop/issues/237) — the renderer
  buttons that call it, replacing #224's inert ones.
- the destructive second-confirm (#226) UX policy (client-side only — no wire signal exists for it).
- surface-rejection (#227), split into a transport half — **[#248](../codebase/248.md) (shipped)**, a
  main-side FIFO correlation window emitting a content-free `modalAnswerRejected` `DaemonEvent` — and a
  render half — **[#249](../codebase/249.md) (shipped)**, which adds the `rejected`/`rejectionDismissed`
  `ModalEvent` arms, the `rejections` slice above, and a transient banner stack at the modal host.

The `modalStore.ts` Zustand-container name this ADR reserved is exactly what
[#223](modal-store-bridge.md) named it, mirroring how [conversation timeline
store](conversation-timeline-store.md) (`timelineStore.ts`, #202) wrapped `reduceTimeline`.

**[#195](../codebase/195.md) (shipped)** — match-and-replace by `modalId`, no-second-notification,
answered-id no-op — the `resolved` field and the `shown` arm's three-case decision above. Confirmed the
ADR's prediction: a one-arm reducer change, no representation refactor, because the model was
id-addressed from the start.
[#196](https://github.com/pyrycode/pyrycode-desktop/issues/196) (reconnect reconcile — filtering
`outstanding` to a daemon-asserted id set on a fresh handshake) remains open; it builds on this store the
same way.

## Edge cases and limitations

- **`shown` for an already-outstanding `modalId` now replaces in place** ([#195](../codebase/195.md)),
  fixing the earlier plain-append (duplicate entry) behavior. A `shown` for an id already in `resolved`
  is a same-reference no-op instead.
- **Unknown/already-dismissed `modalId` on `dismissed` is a silent no-op, not a surfaced error** —
  absorbs a `modal_dismissed` whose `modal_shown` fell before a reconnect replay cursor, or a
  double-dismiss race, without killing the store. Same drop-and-document posture as
  [thread timeline](thread-timeline.md)'s orphan `tool_result`. It also deliberately does **not** record
  the id into `resolved` — the ordering-edge guard ([#195](../codebase/195.md)): recording an
  unknown-id dismiss would permanently suppress a later legitimate `shown` of that same id.
- **`resolved` retains ids forever, with no eviction.** Correct rather than a leak: `modalId`s are
  one-time nonces the daemon never reuses for a new prompt, so a retained resolved id can never
  legitimately need to re-surface. Flagged as a deliberate, evidence-based choice in [#195](../codebase/195.md)
  — no observed growth problem to defend against, and modals are human-gated and rare in practice.
- **`outcome`/`source` still have no home in this state.** A resolved prompt is removed outright, so
  that metadata is carried on the `dismissed` event but never lands in `ModalState`. The anticipated
  "resolution toast" this comment referred to shipped as [#249](../codebase/249.md)'s rejection surface
  — but it consumes a *different*, content-free event (`rejected`, carrying only `modalId`), not
  `dismissed`'s `outcome`/`source`; those two fields remain genuinely unconsumed.
- **Reset-on-reconnect is still not modeled here.** A fresh Noise handshake resetting client control
  state (#879's third sub-rule) is [#196](https://github.com/pyrycode/pyrycode-desktop/issues/196)'s,
  not this ticket's — the `ModalEvent` union has no reset arm; connection state arrives as separate
  `DaemonEvent`s handled elsewhere.
- **Nothing to gate on here.** The `--allow-remote-permissions` grant is a daemon-side, per-device
  flag, not on the wire and not in `PairedServerRecord` — the desktop cannot self-gate. The follow-up
  renders and answers regardless; an ungranted answer round-trips to an `error` envelope.
- **Strangler Fig, not a migration.** `sessionStore` and `threadTimeline` are completely untouched.

## Related

- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — full rationale, every
  reducer arm's normative contract, and the Strangler-Fig coexistence decision.
- [#122 codebase notes](../codebase/122.md) — implementation summary.
- [#201 codebase notes](../codebase/201.md) — the transport slice: wire types, fail-closed decode, and
  the `modalShown`/`modalDismissed` `DaemonEvent` arms this module's `ModalEvent` is the target
  contract for; unblocked [#223](../codebase/223.md) (the bridge + `modalStore.ts` that consumes them).
- [Modal store + bridge](modal-store-bridge.md) / [#223 codebase notes](../codebase/223.md) — the
  Zustand container + `DaemonEvent → ModalEvent` bridge built on this module.
- [Modal resolution envelope](modal-resolution-envelope.md) / [#235 codebase notes](../codebase/235.md)
  — the outbound `modal_answer`/`modal_cancel` wire types + builders, the base slice of the
  answer/cancel path split from #225.
- [Daemon-event channel](daemon-event-channel.md) / [Daemon-event bridge](daemon-event-bridge.md) /
  [Conversation timeline store](conversation-timeline-store.md) — both bridges keep discarding the two
  modal arms as `null`; the real consumer is the third, independent [modal store +
  bridge](modal-store-bridge.md) (#223).
- [Thread timeline (conversation model)](thread-timeline.md) — the #121/ADR 0008 sibling model this
  mirrors piece-for-piece (array + scan-by-id, same-reference no-churn, renderer-local event union,
  `…Store` container reserved for the follow-up).
- [Session store](session-store.md) — the `reduceSession`/`appendUnique` template both pure models
  ultimately derive their reducer discipline from.
- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md) — the sibling
  ADR this one is modeled on.
- [ADR 0004 — Renderer session store](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the pure-reducer / sealed-union / wire-types-are-a-bridge-concern discipline both ADRs extend.
- [#248 codebase notes](../codebase/248.md) — the transport half of surface-rejection: the main-side
  FIFO correlation window and the dormant `modalAnswerRejected` bridge case #249 flips.
- [#249 codebase notes](../codebase/249.md) — the render half: `rejected`/`rejectionDismissed`, the
  orthogonal `rejections` slice, `selectRejections`, and the `RejectionSurfaceView` banner stack at the
  modal host ([Conversation shell](conversation-shell.md)).
- [#195 codebase notes](../codebase/195.md) — match-and-replace by `modalId`: adds `resolved`, makes
  `shown` idempotent, confirms the ADR's "one-arm extension" prediction.
