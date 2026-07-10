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

interface ModalState { outstanding: readonly ModalPrompt[] }
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

### The reducer

`reduceModal(state, event): ModalState` is pure and exported — no mutation, fresh state, `switch`
on `event.type` with an `assertNever` default — the same discipline as `reduceSession` /
`reduceTimeline`:

| event | effect |
|---|---|
| `shown` | append a fresh `ModalPrompt` built from the event's fields. Always a new state. A `shown` for an already-outstanding `modalId` (reconnect re-delivery) is **not** defended here — plain append is correct for first-delivery; match-and-replace is #195's. |
| `dismissed` | remove the `ModalPrompt` whose `modalId` matches. No match (unknown or already-dismissed id) → **same `state` reference**, a deterministic non-throwing no-op (AC4). `outcome`/`source` are carried on the event but not consulted by the reduce — only `modalId` drives the clear. |

`initialModalState = { outstanding: [] }`; the pure selector `selectOutstanding` is the only read
surface, returning `state.outstanding` by reference.

### Internal helpers (unexported)

- `removeById(outstanding, modalId)` — filters by `modalId`, returning the **same array reference**
  when nothing was removed, so `dismissed` can return the same `state` on an unknown id. Mirrors
  `threadTimeline`'s `fillResult` same-reference-on-no-match discipline.
- `assertNever(event)` — the compile-time exhaustiveness guard, reused verbatim from
  `threadTimeline`.

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
- **#223 (next)** — the daemon-event bridge that actually maps the two arms onto `ModalEvent` and
  dispatches into a new `modalStore.ts` Zustand container wrapping `reduceModal` — the consumer this
  module's `ModalEvent` union has been the stable target contract for since #122.
- the interactive render of an outstanding `ModalPrompt` (#224) and the answer/cancel path (#225);
- the destructive second-confirm (#226) / surface-rejection (#227) UX policy (client-side only — no
  wire signal exists for it).

The `modalStore.ts` Zustand-container name is reserved for that follow-up, mirroring how
[conversation timeline store](conversation-timeline-store.md) (`timelineStore.ts`, #202) wrapped
`reduceTimeline`.

[#195](https://github.com/pyrycode/pyrycode-desktop/issues/195) (match-and-replace by `modalId`,
no-second-notification, answered-id no-op) and
[#196](https://github.com/pyrycode/pyrycode-desktop/issues/196) (reconnect reconcile) both build on
this store; the id-addressed array keeps each a small extension rather than a refactor.

## Edge cases and limitations

- **`shown` for an already-outstanding `modalId` plain-appends (a duplicate entry), not a
  replace.** Evidence-based: no re-delivery is receivable yet (the transport doesn't exist), so
  defending it now would guard an unobserved failure mode. #195 owns the match-and-replace fix.
- **Unknown/already-dismissed `modalId` on `dismissed` is a silent no-op, not a surfaced error** —
  absorbs a `modal_dismissed` whose `modal_shown` fell before a reconnect replay cursor, or a
  double-dismiss race, without killing the store. Same drop-and-document posture as
  [thread timeline](thread-timeline.md)'s orphan `tool_result`.
- **No answered-id memory.** A `dismissed` prompt's id can be re-shown by a later `shown` with no
  memory that it was already resolved — deliberately deferred to #195.
- **`outcome`/`source` have no home in this state.** A resolved prompt is removed outright, so the
  resolution metadata is carried on the `dismissed` event for a future consumer (a resolution
  toast) but never lands in `ModalState`.
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
  contract for; unblocks #223 (the bridge + `modalStore.ts` that actually consumes them).
- [Daemon-event channel](daemon-event-channel.md) / [Daemon-event bridge](daemon-event-bridge.md) /
  [Conversation timeline store](conversation-timeline-store.md) — where the two `DaemonEvent` arms
  land today: real producer, zero consumer, both bridges discarding them as `null` until #223.
- [Thread timeline (conversation model)](thread-timeline.md) — the #121/ADR 0008 sibling model this
  mirrors piece-for-piece (array + scan-by-id, same-reference no-churn, renderer-local event union,
  `…Store` container reserved for the follow-up).
- [Session store](session-store.md) — the `reduceSession`/`appendUnique` template both pure models
  ultimately derive their reducer discipline from.
- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md) — the sibling
  ADR this one is modeled on.
- [ADR 0004 — Renderer session store](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the pure-reducer / sealed-union / wire-types-are-a-bridge-concern discipline both ADRs extend.
