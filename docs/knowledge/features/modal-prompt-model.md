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
  conversationId: string   // #878: daemon-asserted scoping label, copied by name, never derived
  modalId: string
  class: ModalClass
  title: string
  prompt: string
  options: readonly ModalOption[]
  defaultOptionId: string
}

type ModalEvent =
  | { type: 'shown'; conversationId: string; modalId: string; class: ModalClass; title: string; prompt: string; options: readonly ModalOption[]; defaultOptionId: string }
  | { type: 'dismissed'; modalId: string; outcome: string; source: 'remote' | 'local' | 'timeout' }
  // #249: a modal answer that round-tripped to a daemon `error`. Produced by the bridge from the
  // content-free `modalAnswerRejected` daemon event (#248) — carries ONLY the `modalId` nonce.
  | { type: 'rejected'; modalId: string }
  // #249: a LOCAL user action — dismissing a rejection banner. Never produced by the bridge.
  | { type: 'rejectionDismissed'; modalId: string }
  // #415: the transport (re)connected — fires on EVERY supervisor (re)handshake, including the first
  // connect. Produced by the bridge from the `connected` DaemonEvent, ignoring its ack. #510: also
  // clears `resolved`. #1140: gained a payload — the conversations belonging to the RECONNECTING
  // server, resolved by the bridge's composition root (never by this pure reducer) — since `connected`
  // means "this server's connection came back" (#1117), not the app's one connection. An empty set
  // (a not-yet-loaded or loaded-empty list) clears nothing and returns the same state (AC4 holds).
  | { type: 'reconnected'; conversationIds: ReadonlySet<string> }
  // #1140: the pairing that held these prompts has ended — dispatched locally by
  // `clearPairingScopedState` (the `rejectionDismissed` precedent), never produced by the bridge.
  // Payload-free and UNSCOPED across all three slices, `rejections` included: every slice is scoped to
  // the pairing that ended and none has a cross-pairing meaning. The only clear that reaches a prompt
  // held for a conversation no server's list ever carried.
  | { type: 'reset' }

interface ModalState {
  outstanding: readonly ModalPrompt[]
  rejections: readonly string[]   // #249: modalIds of round-tripped rejections, arrival order, deduped
  // #195: modalIds that left `outstanding` via `dismissed` — internal bookkeeping only, no selector.
  // #510: PER-CONNECTION memory, cleared on `reconnected` — not permanent (see Edge cases). #1140:
  // narrowed one notch further to per-connection-OF-ONE-SERVER, and each entry became a record —
  // `{ conversationId, modalId }` — because the scoped clear needs the conversation to match on, and
  // it can only be recorded when the id is appended (the `dismissed` arm already holds the prompt).
  // MUST NOT BE PERSISTED: these ids are daemon-side and a re-pair to the same box reuses them.
  resolved: readonly ResolvedModal[]
}

// #1140: one suppression entry. `conversationId` is COPIED off the held `ModalPrompt` at dismissal,
// never derived from `modalId` — the id is a one-time opaque nonce (ADR 0009). A scoping label only,
// exactly as on `ModalPrompt`: it authorises nothing and selects no resource, so no branded type.
interface ResolvedModal { conversationId: string; modalId: string }
```

`ModalPrompt` is the durable, held content; `ModalEvent` is the renderer-local (camelCase) input the
reducer consumes — this union is the stable target contract the bridge maps onto (wire `modal_id` →
`modalId`, `default_option_id` → `defaultOptionId`, thin rename). The `shown` arm carries
`conversationId` ([#877](../codebase/877.md)), copied by name from the `modalShown` `DaemonEvent`
arm; `reduceModal`'s `shown` arm copies it by name onto the held `ModalPrompt` in turn
([#878](https://github.com/pyrycode/pyrycode-desktop/issues/878)), and `selectHasOutstandingFor`
reads it — see § The reducer and § Edge cases and limitations below. **There is no `destructive` wire
class** —
the shipped `class` set is `permission | trust` only; a destructive second-confirm is a client-side
UX policy on the answer path, not a wire distinction.

`outstanding` is an **ordered array**, not a `Map`/`Record`, correlated by `modalId` (the sole
correlation key for *answering* a prompt — a `modal_answer`/`modal_cancel` still carries no
`conversation_id`, unaffected by [#870](../codebase/870.md)/[#871](../codebase/871.md)/
[#877](../codebase/877.md) carrying one on `modal_shown` all the way onto `ModalEvent` itself). This mirrors `ThreadItem`'s array +
scan-by-id shape exactly: the selector returns the array by reference (referential stability for a
future render), and insertion order survives without leaning on `Record` key ordering.

`rejections` ([#249](../codebase/249.md)) is **orthogonal** to `outstanding` — the answered prompt is
already gone by the time a rejection can round-trip (#237's optimistic clear), so a rejection is new UI
state, never a re-surfaced prompt. It holds bare `modalId` strings, not objects: the `rejected` event is
content-free, so there is genuinely nothing else to carry (unlike `dismissed`'s `outcome`/`source`,
which mirror wire fields). Each id doubles as the stable React key when more than one rejection banner
shows. `resolved` is the one slice that **does** hold objects rather than bare ids — see
[#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) below — because a scoped clear needs a
conversation to match on and a `modalId` alone doesn't carry one.

### The reducer

`reduceModal(state, event): ModalState` is pure and exported — no mutation, fresh state, `switch`
on `event.type` with an `assertNever` default — the same discipline as `reduceSession` /
`reduceTimeline`:

| event | effect |
|---|---|
| `shown` | idempotent on `modalId` ([#195](../codebase/195.md)), checked in this order: (1) `modalId` matches an entry in `resolved` → **same `state` reference**, a no-op — already answered/dismissed **within the current connection of that server** ([#510](../codebase/510.md)/[#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) scope this; see below); (2) `modalId ∈ outstanding` → replace that entry in place with the fresh `ModalPrompt` built from the **re-delivered** fields (match-and-replace takes the latest values), position and length preserved, no duplicate; (3) else → append, exactly as first-delivery always did. Always spreads `state` so `rejections`/`resolved` survive. |
| `dismissed` | looks the prompt up in `outstanding` **first** ([#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) — the no-op guard moved here because the arm now needs the held prompt's `conversationId`); no match (unknown or already-dismissed id) → **same `state` reference**, a deterministic non-throwing no-op (AC4), and `resolved` is **not** touched — the ordering-edge guard ([#195](../codebase/195.md)): a `dismissed` for a never-outstanding id must not poison `resolved`, or a later legitimate `shown` of that id would be wrongly suppressed. A genuine removal (`removeById`, spreads `state` so `rejections` survives) also appends `{ conversationId, modalId }` to `resolved` via `appendResolved`, the conversation copied off the prompt just found — `dismissed` is the single choke point a prompt leaves `outstanding` through (answer/cancel/remote/timeout all dispatch it), so this one arm covers "already answered or dismissed." `outcome`/`source` are carried on the event but not consulted by the reduce — only `modalId` drives the clear. |
| `rejected` ([#249](../codebase/249.md)) | append `modalId` to `rejections`, de-duplicated (`appendUnique`). Repeat id → **same `state` reference** (no churn); `outstanding` is untouched. |
| `rejectionDismissed` ([#249](../codebase/249.md)) | remove `modalId` from `rejections` (`removeRejection`). Unknown/already-dismissed id → **same `state` reference**, a non-throwing no-op; `outstanding` is untouched. |
| `reconnected` ([#415](../codebase/415.md); [#510](../codebase/510.md); [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)) | drops, from **both** `outstanding` and `resolved`, only the rows whose `conversationId` is in the event's `conversationIds` set (one shared helper, `dropListed`), so the daemon's connect-time re-sends become the sole repopulation truth for **that server's** conversations; a still-held prompt re-appends via the `shown` arm exactly once, and a prompt the client answered while disconnected (send swallowed, `resolved` recorded it anyway) now re-surfaces instead of staying suppressed. A prompt or suppression entry whose conversation is in **no** server's list survives every `reconnected` — the accepted, pinned consequence of scoping by the list; only `reset` ever collects one. `rejections` still survives by reference untouched (no daemon repopulation path, and never scoped — see #1140 below). Each slice is guarded independently inside `dropListed`: a slice the set does not touch keeps its reference (`PermissionModal` selects `outstanding` under `Object.is`), and an empty set — first connect, or a server holding nothing here — returns the same `state` reference (AC4). |
| `reset` ([#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)) | the pairing boundary: returns `initialModalState` **by reference**, clearing all three slices including `rejections` (never touched by `reconnected`) and any prompt/suppression entry `reconnected` could never reach because its conversation was in no server's list. Dispatched only by `clearPairingScopedState`, never by the bridge. |

Note that `shown`/`dismissed` originally built their return value as `{ outstanding: … }` — #249 changed
both to `{ ...state, outstanding: … }` so they stop silently dropping the (then-new) `rejections` field;
any future field added to `ModalState` needs the same audit of every non-spreading reduce arm. [#195](../codebase/195.md)
confirmed the audit still held when it added `resolved`: both arms already spread `state`.

`initialModalState = { outstanding: [], rejections: [], resolved: [] }`; `selectOutstanding` and
`selectRejections` return their slice by reference, and `selectHasOutstandingFor(conversationId)`
([#878](https://github.com/pyrycode/pyrycode-desktop/issues/878)) — a selector *factory*, matching
`selectActivityFor` / `selectRosterFor` / `selectBacklogFor` — is a third read surface answering
whether any prompt in `outstanding` belongs to that conversation: an `Array.prototype.some` with
`===` over `conversationId`, deliberately not a keyed lookup (see § Edge cases). All three are
re-exported from `modalStore.ts` alongside the Zustand container. `resolved` has no selector — it is
internal reducer bookkeeping only, never read outside `reduceModal` itself.

### Internal helpers (unexported)

- `removeById(outstanding, modalId)` — filters by `modalId`, returning the **same array reference**
  when nothing was removed. Since [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) its
  sole caller (`dismissed`) looks the prompt up **before** calling, because the arm needs the held
  prompt's `conversationId` to record it, so this helper's own no-match path is no longer what does the
  work — kept rather than inlined, since the contract is the discipline `removeRejection`/`dropListed`
  also hold and a helper that cannot no-op is a trap for the next caller. Mirrors `threadTimeline`'s
  `fillResult` same-reference-on-no-match discipline.
- `appendUnique(rejections, modalId)` ([#249](../codebase/249.md)) — appends if absent, else returns the
  **same array reference** (defends #248's FIFO window redelivering an id in a race). Mirrors
  `removeById`'s same-reference-on-no-change contract for the append direction. Used only by `rejected`
  as of [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) — `dismissed` moved to
  `appendResolved` once `resolved` became record-shaped (see below).
- `removeRejection(rejections, modalId)` ([#249](../codebase/249.md)) — `removeById`'s twin over
  `readonly string[]`.
- `appendResolved(resolved, entry)` ([#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140))
  — `appendUnique`'s sibling for the record-shaped slice: de-duplicates on `entry.modalId`, returning the
  **same array reference** on a repeat. Kept separate from `appendUnique` rather than generalised into
  one helper, because the two dedupe on different things (a whole string vs. one field of a record) and
  collapsing them would hide which.
- `dropListed(rows, conversationIds)` ([#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140))
  — the one generic helper both scoped slices share: keeps every row whose `conversationId` is **not**
  in the set, returning the **same array reference** when nothing matched. One helper for both
  `outstanding` and `resolved` because they are scoped by the same key, so a future change to what
  "belongs to this server" means has one place to land and the two slices cannot drift into a
  half-scoped clear. Membership is `Set.has` over own field values, never a bare object keyed by id or
  a re-key of either slice by `conversationId` — `ServerOrigin`'s docblock rules a `Set` for any
  daemon-id-indexed lookup (a `__proto__` id would otherwise resolve onto `Object.prototype`), and
  `selectHasOutstandingFor`'s docblock rules the array-scan form for the same prototype reason.
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
[#196](https://github.com/pyrycode/pyrycode-desktop/issues/196) (reconnect reconcile) split 2-way:
**[#415](../codebase/415.md) (shipped)** — the `reconnected` arm above, clearing `outstanding` on every
supervisor (re)handshake and letting the daemon's connect-time re-sends repopulate through the existing
`shown` arm; sibling **[#197](../codebase/197.md) (shipped)** owns the separate `queue_state`
replacement-truth reset on the same edge, a different store.

**[#510](../codebase/510.md) (shipped)** — found #415 AC3's premise wrong (retaining `resolved` across
the reset does not guard against a double-show; the daemon only ever re-sends still-outstanding
prompts) and reversed it: the `reconnected` arm now clears `resolved` too, so a prompt answered while
disconnected — its send swallowed by the transport, its id recorded into `resolved` anyway — re-surfaces
instead of silently decaying into a deny-on-timeout.

**[#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) (shipped)** — since
[#1117](daemon-connection-routing.md) the background process holds one live connection per paired
server, so `connected` (and this arm's `reconnected`) means "**this** server's connection came back,"
not the app's one connection. A payload-free `reconnected` took down a prompt another server was still
waiting on and dropped that server's suppression bookkeeping with it. Scoped both `outstanding` and
`resolved` to the reconnecting server's own conversations (a new `conversationIds` payload, resolved by
[modal store + bridge](modal-store-bridge.md)'s composition root via #1138's shared resolution), gave
`resolved` a conversation-carrying element shape (`ResolvedModal`) so it can be scoped the same way, and
added a payload-free `reset` arm — dispatched by `clearPairingScopedState` — as the pairing-boundary
counterweight the scoped edge now needs (see § Edge cases).

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
- **`resolved` is per-connection-of-one-server memory, scoped-cleared on every `reconnected` edge
  ([#510](../codebase/510.md); [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)), not
  retained forever, and not cleared wholesale.** #195 and #415 originally reasoned that `modalId`s are
  one-time nonces, so a retained id could "never legitimately need to re-surface" — and shipped #415 AC3
  preserving `resolved` across the reset on that basis. [#510](../codebase/510.md) found the premise
  wrong: the outbound answer send is fire-and-forget (`answerModal` early-returns on a null driver while
  disconnected), so a `resolved` id can mean "the client *tried* to answer" rather than "the daemon has
  it." The daemon's connect-time reconcile re-sends only **still-outstanding** modals (`Registry.Snapshot()`,
  pyrycode #876/#877) — so retaining `resolved` across a reconnect suppressed exactly the case it needed
  to let through: an Allow clicked while the link was down, decaying into a deny-on-timeout with no way
  to re-answer. [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) narrowed the clear one
  notch further, from "every reconnect" to "the reconnecting server's own conversations": clearing the
  slice wholesale on server B's reconnect would re-surface, on server A, a prompt the operator already
  answered there — the exact bug this bookkeeping exists to prevent, just on the other server. Within a
  single connection of a server `resolved` still dedupes as before — it is deliberately **not** removed
  outright, since it backstops duplicate within-connection delivery (AC2's ordering edge). A `resolved`
  entry for a conversation no server's list ever carried survives every reconnect; only `reset` collects
  it (see below).
- **`outcome`/`source` still have no home in this state.** A resolved prompt is removed outright, so
  that metadata is carried on the `dismissed` event but never lands in `ModalState`. The anticipated
  "resolution toast" this comment referred to shipped as [#249](../codebase/249.md)'s rejection surface
  — but it consumes a *different*, content-free event (`rejected`, carrying only `modalId`), not
  `dismissed`'s `outcome`/`source`; those two fields remain genuinely unconsumed.
- **Reset-on-reconnect ([#415](../codebase/415.md); [#510](../codebase/510.md);
  [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)).** A fresh Noise handshake resetting
  client control state (#879's third sub-rule) clears, from **both** `outstanding` and `resolved`, the
  rows belonging to the reconnecting server via the `reconnected` arm, produced by `modalBridge.ts` from
  the `connected` `DaemonEvent` that fires on every supervisor (re)handshake — scoped since #1140 to that
  server's own conversations rather than the whole store, since [#1117](daemon-connection-routing.md)
  made `connected` mean "this server's connection came back." `rejections` still survives by reference —
  it has no daemon repopulation path and is never scoped, only ever cleared by `reset`. The sibling
  `queue_state` reset (a different store) shipped as [#197](../codebase/197.md).
- **Pairing-boundary clear, unscoped ([#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)).**
  Scoping the `reconnected` edge opened a hole at the pairing boundary: a new pairing's first `connected`
  resolves the new server's (empty) conversation list, matches nothing, and drops nothing, so a departed
  pairing's `outstanding` prompts and `resolved` entries would otherwise latch for the life of the
  process — the residue is actionable, not merely stale, since a retained prompt is a live control
  carrying a departed daemon's untrusted `title`/`prompt`/`options[].label`, answerable with a
  `modal_answer` for a `modalId` the currently paired daemon never issued. The `reset` `ModalEvent`
  (payload-free, dispatched by `clearPairingScopedState`, never by the bridge) closes it by returning
  `initialModalState` — all three slices, `rejections` included, since every slice is scoped to the
  pairing that ended. This retired `modalStore`'s exclusion from `clearPairingScopedState`'s dep set —
  see [`clearPairingScopedState`](paired-shell.md#related), which had cited this store by name as
  self-healing. Same sequence [#1086](conversation-list-store.md), [#1138](queue-store.md) and
  [#1139](background-task-roster-store.md) each ran through.
- **Nothing to gate on here.** The `--allow-remote-permissions` grant is a daemon-side, per-device
  flag, not on the wire and not in `PairedServerRecord` — the desktop cannot self-gate. The follow-up
  renders and answers regardless; an ungranted answer round-trips to an `error` envelope.
- **Strangler Fig, not a migration.** `sessionStore` and `threadTimeline` are completely untouched.
- **`conversationId` rides the full chain onto the held prompt and is read by one selector**
  ([#877](../codebase/877.md)/[#878](https://github.com/pyrycode/pyrycode-desktop/issues/878), both
  shipped) — the wire's outbound-scoping `conversation_id` (pyrycode#1065) reaches `ModalEvent` via the
  `DaemonEvent` arm ([#871](../codebase/871.md), decoded [#870](../codebase/870.md)), is copied by name
  into the `shown` arm (#877), and `reduceModal`'s `shown` arm copies it by name a hop further onto the
  held `ModalPrompt` literal (#878) — required, never derived from `modalId`, which stays an opaque
  answer-correlation nonce. `selectHasOutstandingFor(conversationId)` is the one reader: an `===` scan
  over `outstanding`, never a keyed container, so the daemon-asserted id has no prototype hazard to
  exploit and the array keeps the referential stability ADR 0009 chose it for. It does not change
  id-addressing: `modalId` remains the sole correlation key for *answering* a prompt — `modal_answer` /
  `modal_cancel` carry no `conversation_id`. The consumer is the sidebar's status resolver (the
  input-required dot in [conversation status](conversation-status.md)), which reads the boolean, not
  the prompt.

## Related

- [Question-shown wire types](question-shown-wire-types.md) — claude's clarifying-question batch
  (`question_shown`, #883), a **sibling frame family rather than a grown `modal_shown`**: this
  family's `default_option_id` is a total invariant on the permission surface (must equal one of
  `options[].id`), and a clarifying question has no deny option, so growing this payload would have
  made that invariant class-conditional. Wire vocabulary only so far — no store, no reducer, no
  consumer.
- [Question-batch model](question-batch-model.md) — the question vertical's counterpart to this
  module (#898, shipped): a pure `reduceQuestionBatches` reducer over an id-addressed
  `QuestionBatch[]`, cloning this module's discipline under the same ADR 0009 rather than minting a
  sibling ADR. Diverges on purpose in three places — two nesting levels (`options` per question),
  no `id` on the option row, and **no `resolved` id-memory**, since that vertical has no optimistic
  local answer and no answer frame at all yet, so the failure `resolved`/#510 defends here cannot
  occur there.
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
- [#415 codebase notes](../codebase/415.md) — reconnect reconcile: the `reconnected` arm clearing
  `outstanding` on every supervisor (re)handshake, split-child A of #196 (sibling
  [#197](../codebase/197.md) owns the separate `queue_state` reset).
- [#510 codebase notes](../codebase/510.md) — the `reconnected` arm also clears `resolved`, reversing
  #415 AC3: a prompt answered while disconnected re-surfaces after the reconnect instead of staying
  suppressed.
- [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) · Spec:
  `docs/specs/architecture/1140-scoped-modal-reconnect-clear.md` — scopes `reconnected` to the
  reconnecting server's own conversations (`conversationIds`, resolved by [modal store +
  bridge](modal-store-bridge.md) via #1138's shared resolution), gives `resolved` the `ResolvedModal`
  element shape so it can be scoped the same way, and adds the pairing-boundary `reset` arm — the same
  fix [#1138](conversation-list-store.md) and [#1139](background-task-roster-store.md) shipped for
  `queueStore` and `backgroundTaskRosterStore`, applied to the store whose residue is the most
  actionable of the three (a live permission control, not stale display). Security review PASS; the one
  residual risk named — conversation ids are daemon-side and not globally unique across servers, so a
  hostile daemon B listing an id server A also uses can clear A's matching prompt and suppression entry
  — is strictly narrower than today's whole-store clear and is accepted pending a wire-level globally
  unique conversation identity (out of scope, no ticket yet).
- [#877 codebase notes](../codebase/877.md) — carries `conversation_id` (pyrycode#1065, decoded
  [#870](../codebase/870.md), carried onto `DaemonEvent` by [#871](../codebase/871.md)) the last hop
  onto `ModalEvent`'s `shown` arm, by name; the reducer did not yet read it.
- [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) (shipped) — the terminus: copies
  `conversationId` by name onto the held `ModalPrompt` and adds `selectHasOutstandingFor`, the
  boolean read the sidebar's status resolver ([conversation status](conversation-status.md)) needs for
  the input-required dot. Security-sensitive (a permission prompt's `prompt` field is a tool title and
  command line, and must never be reported against another conversation) — reviewed PASS on the record
  (architect self-review + code review), resting on the `===` array scan having no prototype hazard and
  the value being copied, never derived from the `modalId` nonce.
