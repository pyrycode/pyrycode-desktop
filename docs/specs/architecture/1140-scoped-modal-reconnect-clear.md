# 1140 — Scope the modal reconnect clear to the reconnecting server

## Files read

- `src/renderer/src/store/modalPrompts.ts` → `ModalEvent`, `ModalState`, `reduceModal`, `removeById`,
  `appendUnique`, `selectHasOutstandingFor` — the reducer this slice edits. The `reconnected` arm is the
  whole-state clear being scoped; `resolved`'s element shape changes here.
- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`, `subscribeModal`, `useModalBridge` —
  the `connected` → `reconnected` mapping and the composition root that must resolve the origin.
- `src/renderer/src/store/modalStore.ts` → `createModalStore`, `modalStore` — `dispatch` is the sole
  write path and the store exposes no setter, which is why the pairing clear arrives as a dispatched
  action rather than a `clearAllModals()` method. **Not edited by this slice.**
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `originOf`, `subscribeBackgroundTaskRoster`,
  `BackgroundTaskRosterData` — #1139's template, and the docblock that rules this bridge keeps the
  translator mapping rather than moving to a pre-translator branch.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `resetRostersFor`, `clearAllRosters` — the
  two-mechanism split (scoped edge + pairing clear) this slice repeats, and the `Set.has` over held keys
  discipline.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationIdsFor`,
  `EMPTY_CONVERSATION_IDS`, `ConversationListOrigin` — #1138's shared resolution. Its docblock names
  this ticket as one of its three intended consumers; the type is the clear's key domain.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`,
  `clearPairingScopedState` — the twelve-member dep set gaining a thirteenth, and the header paragraph
  that cites `modalStore` **by name** as a self-healing store.
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps` — the dep-object wiring; neither call site is
  edited.
- `src/renderer/src/screens/conversation/modalResolution.ts` → `selectOption`, `cancelModal` — the only
  other production dispatcher into this store; both dispatch `dismissed`, neither switches over
  `ModalEvent`, so the new member reaches no exhaustive switch outside `reduceModal`.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` → the `outstanding` selector consumer that
  makes the same-reference-on-no-change property load-bearing.
- `src/renderer/src/store/modalPrompts.test.ts` → the local `reconnected()` builder (13 call sites) and
  ~25 `resolved` assertion sites.
- `src/renderer/src/store/modalBridge.test.ts`, `src/renderer/src/clearPairingScopedState.test.ts`
  (`spyDeps`, the `Object.keys(deps).sort()` pin, the throw-ordering cases),
  `src/renderer/src/PairedShell.test.tsx` — the test surfaces that move.
- `src/renderer/src/screens/channels/ChannelList.test.tsx`,
  `src/renderer/src/screens/conversation/PermissionModal.test.tsx` — the two out-of-module tests that
  dispatch `{ type: 'reconnected' }` into a modal store instance.
- `docs/knowledge/features/renderer-stores.md` — package overview; read for the prior tickets' lessons
  in this area.

**Codegraph gap:** every `mcp__codegraph__*` call fails with "CodeGraph not initialized" in this repo, so
the reading list above was built with Grep and Read.

## Design source

No `## Figma` section on the ticket, and none is owed: this slice adds no component, no token, no layout
and no copy. It changes which already-designed `PermissionModal` prompts and which sidebar
`--input-required` dots survive an event, and the visual treatment of both is unchanged. The
visual-fidelity check is not applicable.

## Context

Since #1117 the background process holds one live connection per paired server, and since #1068 every
daemon event carries the id of the server it came from. `connected` therefore means "**this** server's
connection came back", but `reduceModal`'s `reconnected` arm still empties `outstanding` and `resolved`
wholesale. Server B reconnecting takes down a permission prompt server A is still waiting on — a prompt
only A's own reconcile could re-send — and drops A's suppression bookkeeping, so a duplicate `shown` on
A's still-live connection re-surfaces a prompt the operator already answered. That second failure is
precisely what #195's `resolved` exists to prevent, so both slices are scoped here.

Scoping the edge removes the self-heal that kept `modalStore` out of `clearPairingScopedState`'s dep set
— that file cites the store by name. Once the edge is scoped, a new pairing's first `connected` resolves
the new server's conversation list (empty: its `list_conversations` reply has not landed), matches
nothing, and drops nothing, so the departed pairing's prompts and suppression entries latch for the life
of the process. The residue is actionable, not merely stale: a phantom permission dialog carrying a
departed daemon's untrusted `title` / `prompt` / `options[].label`, whose answer emits a `modal_answer`
for a `modalId` the current daemon never issued; and a retained `resolved` entry that silently suppresses
a genuine `shown`. The pairing clear is therefore part of this slice, not a follow-up — the same sequence
#1086, #1138 and #1139 each ran through.

#415's rule is preserved for the reconnecting server: the daemon's connect-time re-sends stay the sole
repopulation truth there. Only the blast radius changes.

**No ADR is warranted.** The two-mechanism split (scoped `connected` edge + pairing-boundary clear) is
already recorded by #1138 and #1139 in `clearPairingScopedState`'s header and the two stores' docblocks;
this is the third application of a settled pattern, not a new decision.

**Size:** ~1250 lines of total written work over 4 production files — over the table's 800-line ceiling,
deliberately, on the floor-outranks-ceiling rule. Both candidate cuts fail the floor: splitting
`outstanding` from `resolved` has the second ticket re-edit the arm the first just wrote behind one event
payload, and splitting the pairing clear off ships a security-sensitive store leaking a departed
pairing's actionable prompts with every criterion of the first ticket green. The file (4), exported-name
(1), production call-site, criteria (5) and reject-branch lines all hold. Measured siblings: #1139 at
`5fee0dd` (1122 lines of plan + production + tests), #1138 at `9de6fd3` (996).

## Design

### 1. `modalPrompts.ts` — the reducer

**`resolved` gains a conversation.** A new exported element type replaces the bare `modalId` string:

```ts
export interface ResolvedModal {
  conversationId: string
  modalId: string
}
```

`ModalState.resolved` becomes `readonly ResolvedModal[]`. The conversation is available exactly where the
id is appended: the `dismissed` arm removes the prompt whose conversation id it is, in the same reducer
step. `resolved` has no reader outside this module (confirmed by grep — no selector, no consumer), so the
shape change is contained to `modalPrompts.ts` and its test.

**`reconnected` gains a payload.** The member becomes
`{ type: 'reconnected'; conversationIds: ReadonlySet<string> }` — the conversations belonging to the
reconnecting server, resolved by the caller. The translator returns members of an action union, so a
member gaining a field costs no widening; this is the shape `backgroundTaskRosterBridge`'s docblock rules
for this bridge by name.

**A new `reset` member**, `{ type: 'reset' }` — the pairing-boundary clear, dispatched locally (the
`rejectionDismissed` precedent), never produced by the bridge. Its arm returns `initialModalState` **by
reference**, exactly as `reduceTimeline`'s and `reduceSession`'s `reset` arms do, so all three slices come
back by reference and an already-initial store hands the same object back.

**Why an action, not a store setter.** `clearPairingScopedState` carries both shapes, and the
discriminator is the store's own write contract: the five recent `clearAll*` members are setters on
Map-keyed stores with no reducer, while `dispatchTimeline` and `dispatchSession` are the two
reducer-backed stores. `modalStore` is the third; its docblock rules `dispatch` the sole write path with
no exposed setter. An action also keeps the compile gate — a new member without an arm is an
`assertNever` type error — and lets the dep set stay typed against the real action union, so the
dispatched shape is compile-checked and the test asserts the exact payload.

**Arms:**

- `shown` — the duplicate-delivery early-out becomes a `some` on `modalId` over the record array. Same
  behaviour, same same-reference no-op.
- `dismissed` — a `find` on `modalId` over `outstanding` is now the no-op guard (unknown or
  already-dismissed id → same state), because the arm needs the held prompt's `conversationId` to record
  it. Removal still goes through `removeById`; a new `appendResolved(resolved, entry)` de-duplicates on
  `modalId` and returns the same reference on a repeat, mirroring `appendUnique`, which stays as-is for
  the string-keyed `rejections`.
- `reconnected` — both slices go through one generic helper:

```ts
function dropListed<T extends { conversationId: string }>(
  rows: readonly T[],
  conversationIds: ReadonlySet<string>
): readonly T[]
```

  It keeps every row whose `conversationId` is **not** in the set and returns the SAME array reference
  when nothing is dropped. One helper serves both slices because both now carry a conversation. The two
  independent guards survive as the same-reference returns from `dropListed`, and the arm returns
  `state` when neither slice changed. An empty set — `EMPTY_CONVERSATION_IDS`, which is what a not-loaded
  or loaded-empty slot resolves to — matches nothing and hands the state object straight back (#415 AC4).
  A prompt whose conversation appears in no server's list is left alone: the accepted, pinned consequence
  of scoping by the list, and the only thing that ever collects one is the pairing clear.
- `reset` — returns `initialModalState`. All three slices, `rejections` included: every slice is scoped
  to the pairing that ended and none has a cross-pairing meaning.

`Set.has` over own field values, never a re-key of `outstanding` by conversation id:
`selectHasOutstandingFor`'s docblock rules the array-scan form and states the prototype-hazard reason, and
`ServerOrigin`'s docblock rules a `Set` (not a bare object) for any consumer indexing by a daemon-adjacent
id. A scoped clear that scans field values keeps both true.

### 2. `modalBridge.ts` — the origin, read off the stamp

A local `originOf(event): ConversationListOrigin` over `'serverId' in event`, copied rather than imported
— five precedents (`relayLinkBridge`, `conversationListBridge`, `daemonEventBridge`, `queueBridge`,
`backgroundTaskRosterBridge`), each stating that importing another's would couple two deliberately
independent subscribers. The origin is read ONLY from the stamp, never from `event.ack.server_id`: the
stamp is bound main-side from a paired record this client holds, so a hostile daemon cannot make its
reconnect clear another server's prompts.

The translator keeps its shape and gains an injected resolver:

```ts
export function translateModalEvent(
  event: DaemonEvent,
  conversationIdsFor: (origin: ConversationListOrigin) => ReadonlySet<string>
): ModalEvent | null
```

The `connected` case returns `{ type: 'reconnected', conversationIds: conversationIdsFor(originOf(event)) }`.
Injection, not a store read, is what keeps the bridge store-free and drivable with plain spies — a store
read inside it would be untestable under this repo's node-environment renderer tests. `subscribeModal`
threads the same parameter through. `useModalBridge`, the composition root, supplies
`(origin) => selectConversationIdsFor(origin)(conversationListStore.getState())` — the list read happens
at event time inside the effect, never at subscribe time and never during render, so `window.pyry` and
both singletons stay out of the render path. The exhaustive `assertNever` switch is untouched otherwise.

### 3. `clearPairingScopedState.ts` — the thirteenth member

`ClearPairingScopedStateDeps` gains `dispatchModal: (event: ModalEvent) => void`, and the body calls
`deps.dispatchModal({ type: 'reset' })` between `clearAllRosters()` and `dispatchSession({ type: 'reset' })`
— position free among the in-memory effects, but before `clearAllLastRead`, which stays last for the
throw-ordering reason the header gives.

### 4. `PairedShell.tsx` — the wiring

`clearPairingDeps` gains `dispatchModal: (event) => modalStore.getState().dispatch(event)`, the
`dispatchTimeline` / `dispatchSession` shape. Neither call site is edited.

### 5. Docblocks — five rewrites, part of the deliverable

Each of these asserts a guarantee this slice relocates or narrows; a reader left trusting one would be
trusting something that has moved. Rewritten, not extended:

- `modalPrompts.ts`, the `reconnected` union member ("Carries no payload — the reset needs nothing from
  the connect ack").
- `modalPrompts.ts`, `resolved` on `ModalState` — per-CONNECTION becomes per-connection-per-server, and
  the element shape changes.
- `modalPrompts.ts`, `reduceModal`'s header — #510's scoping of the duplicate-delivery clause.
- `modalPrompts.ts`, the `reconnected` arm — where #510's reversal of #415 AC3 and the two independent
  guards are written down.
- `clearPairingScopedState.ts`, the header paragraph citing `modalStore` **by name** as a self-healing
  store, plus the twelve → thirteen number words (spelled in words at eleven sites in that file and four
  in its test — grep the number words, not the identifier).

## State + concurrency model

Three renderer stores, no async. `modalStore` (reducer-backed, app singleton) is written only through
`dispatch`; `conversationListStore` is READ, once, inside the daemon-event listener at reset time — never
subscribed to, because `selectConversationIdsFor` returns a fresh `Set` per non-empty call and has no
referential stability. Both reads happen in the same synchronous dispatch with no `await` between them,
so nothing can interleave between resolving the id set and folding it into the state.

Reading the list at event time rather than subscribe time is load-bearing: on a first connect the
server's slot holds no list yet (the list request rides the same edge) so nothing is dropped; on a
reconnect the slot still holds the previous episode's rows — only `clearAllConversations` at a pairing
boundary empties it — so the reconnecting server's conversations are known.

Lifecycle is unchanged: `useModalBridge` subscribes on mount and returns the off handle as the effect
cleanup, so a StrictMode double-mount nets exactly one live listener. No timers, no `AbortController`, no
new long-lived work.

Same-reference-on-no-change is the property both new clears must hold. `PermissionModal` selects
`outstanding` under `Object.is`, so a fresh `[]` re-renders it for no state change; `dropListed` returns
the input array when it drops nothing and the arm returns `state` when neither slice moved. The `reset`
arm returns `initialModalState` by reference, so a redundant pairing clear wakes no listener at all — the
subscriber short-circuit the whole-map clears in that dep set carry.

## Error handling

No I/O, no IPC, no parsing — pure renderer state, so there is no result type to thread. The reducer keeps
its deterministic, non-throwing discipline on every unknown input: an unknown `modalId`, an origin that
matches no slot, and a conversation id in no server's list are all legitimate queries answered with a
no-op, never a throw. `originOf` is total by construction — a `serverId` that is neither a string nor
`null` selects the unstamped slot rather than throwing, which is what keeps it safe inside a daemon-event
listener. `dispatchModal` is a pure in-memory store write and cannot throw, so it adds no abort risk to
`clearPairingScopedState`'s ordering constraint; it is placed before `clearAllLastRead` anyway.

Nothing is logged. `clearPairingScopedState`'s no-diagnostic property is total, and the only values a
diagnostic on either new path could carry are daemon-supplied conversation ids and untrusted prompt text.

## Testing strategy

All vitest, node environment, static — no DOM and nothing to click. No Playwright spec is added:
`e2e/permission-modal-answer-paths.spec.ts` runs one server and must stay green unchanged, and the fake
tier cannot drive two paired servers.

`modalPrompts.test.ts` — the local `reconnected()` builder takes the conversation ids explicitly
(`reconnected('conv-m1')`), so all 13 existing sites state what they scope to; ~25 `resolved` assertion
sites move from `['m1']` to `[{ conversationId: 'conv-m1', modalId: 'm1' }]`. New cases:

- Two conversations outstanding; a reconnect naming one leaves the other's prompt and drops that one's
  (AC1).
- The same, for `resolved`: an entry for the un-named conversation still suppresses a duplicate `shown`,
  while a re-sent prompt on the named one re-surfaces (AC2).
- An empty set clears nothing and returns the **same state object**, `toBe`-asserted (AC3, #415 AC4).
- A prompt whose conversation is in no set is left alone by a scoped clear, then dropped by `reset`
  (AC3's pin + AC4).
- `dismissed` records the held prompt's conversation id; a never-outstanding `dismissed` records nothing.
- `reset` returns `initialModalState` by reference, and clears `rejections` too (AC4).
- Purity: the input state and both arrays are unmutated across a scoped clear.

`modalBridge.test.ts` — `connected` translates to a `reconnected` carrying exactly the ids the injected
resolver answered for the event's origin; a stamped, an unstamped-`null`, and an absent-stamp event each
select their own slot (AC3); `event.ack.server_id` is set to a DIFFERENT value from the stamp and the
resolver is asserted to have been called with the stamp's (AC5). The existing translator call sites gain
the stub resolver.

`clearPairingScopedState.test.ts` — the `Object.keys(deps).sort()` pin gains `dispatchModal`; `spyDeps`
gains the spy and the destructure; `dispatchModal` is asserted called once with exactly `{ type: 'reset' }`
and before `clearAllLastRead`; a real-store integration case seeds a prompt AND a resolved entry for a
conversation no list carries, shows the scoped edge alone does not evict them, and shows the pairing clear
does (AC4).

`PairedShell.test.tsx` — the dep object's new member reaches `modalStore`.

`ChannelList.test.tsx` and `PermissionModal.test.tsx` — the two out-of-module `{ type: 'reconnected' }`
dispatches gain the conversation ids they mean.

**The failure that would pass green:** scoping `outstanding` and leaving `resolved` cleared wholesale
compiles, and every AC1 test stays green. AC2's cross-server suppression case is the only detector, which
is why it is written first. Second: `npm test` can be green while the dep wiring is incomplete — six of
the eight sites in `clearPairingScopedState.test.ts` are `tsc`-only and the missed `spyDeps` destructure
fails as a bare `ReferenceError`. `npm run build` is the gate that catches it.

## Open questions

1. **Does `removeById` keep its same-reference-on-no-match guard?** The `dismissed` arm now guards with a
   `find` ahead of it, so that path is unreachable from its sole caller. Resolve during implementation:
   keep the helper and say so in its docblock, or fold the filter into the arm. Leaning keep — the
   contract is documented discipline shared with `removeRejection`, and deleting it is a refactor this
   ticket was not asked for.
2. **Does the new `reset` member want the name `reset` or `pairingEnded`?** `reset` matches
   `dispatchTimeline`/`dispatchSession`'s dispatched payload exactly, which is what the dep set's other
   two dispatch members read like. Leaning `reset`.

Each is resolved in Phase B and recorded under `## Revisions` if the resolution changed the design.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] Named, and the design's central rule.** Two provenances meet on the `connected`
  arm and the plan keeps them apart by construction: the `serverId` STAMP is client-bound main-side from
  a paired record this client holds, and `event.ack.server_id` is a value the DAEMON chose. `originOf`
  reads only the stamp, and it lives inside the bridge rather than at the caller, so no caller can pick
  the origin — the composition root is handed an already-derived origin and only maps it to ids. The
  second boundary is the id set itself: `selectConversationIdsFor` carries `selectConversationsFor`'s
  "CALL IT WITH A CLIENT-HELD ID" rule forward by construction, and the plan adds no second read of
  `byServer`. AC5 is tested adversarially — the `ack.server_id` is seeded to a DIFFERENT value from the
  stamp and the resolver asserted called with the stamp's.
- **[Trust boundaries] Residual, accepted, and strictly narrower than today.** Conversation ids are
  daemon-side and not globally unique across servers, so a hostile daemon B that lists an id server A is
  also using can make B's reconnect clear A's prompt for that id — and clear A's matching suppression
  entry, so a duplicate `shown` on A re-surfaces an already-answered prompt. The worst case under this
  design is therefore exactly the behaviour that ships today (B's reconnect clears everything), so the
  change is a strict reduction in blast radius, never a widening. Closing it needs globally unique
  conversation identity on the wire — a daemon-and-mobile contract change, out of scope here and owned by
  no ticket yet. #1138 and #1139 carry the identical property through the same shared resolution.
- **[Tokens, secrets, credentials] No findings, plus one forward obligation.** No token, key, or
  credential is on this path. `modalId` is a one-time daemon-issued correlation nonce, not a secret, and
  it neither leaves renderer memory nor reaches a log. `resolved` gains a `conversationId` it did not
  hold, but that value was already held on the `ModalPrompt` beside it, so nothing newly enters the
  renderer. THE OBLIGATION: this store must never be persisted. `resolved` now carries daemon-supplied
  conversation ids, and a re-pair to the same box reuses them, so a persisted entry would suppress a
  genuine `shown` on a later pairing. The pairing clear the plan adds reaches memory only, and that is
  sufficient exactly while the store stays in memory. Recorded in the store's docblock in Phase B.
- **[File / storage operations] No findings — no path, no file, no web storage.** The one adjacent
  hazard is ordering, and it is addressed: `clearAllLastRead` is the sole effect in
  `clearPairingScopedState` that reaches disk and so the sole one that can throw. `dispatchModal` placed
  after it would be aborted by a `localStorage` throw, leaving the departed pairing's actionable prompts
  live. The plan places it before, and the test pins call order rather than trusting the docblock.
- **[Inter-process / Electron attack surface] No findings.** No IPC channel, no `contextBridge` surface,
  no preload change, no `webPreferences` touched. The bridge subscribes through the existing
  `window.pyry.onDaemonEvent` and adds one renderer-local store read. No secret, socket, key or raw frame
  is reachable from anything this slice writes.
- **[Cryptographic primitives] Not applicable.** No RNG, no key material, no comparison against a secret.
  The `modalId` nonce is generated daemon-side and is compared here only to route a UI clear — never to
  authorise anything, which is why `===` (not `timingSafeEqual`) is correct for it.
- **[Network & I/O] Not applicable to the code, with one growth surface named.** No socket, URL, frame
  cap or timeout is on this path. Scoping does change WHEN state is collected: a prompt (or suppression
  entry) for a conversation that appears in no server's list is no longer dropped by any reconnect, only
  by the pairing clear. A hostile daemon can reach that state deliberately by raising prompts for
  conversations it never lists. This is the accepted consequence AC3 pins on purpose, and the pairing
  clear is its bound. OUT OF SCOPE: neither `outstanding` nor `resolved` has ever carried a cap, at any
  point on this path, so unbounded growth within a single connection pre-exists this slice and is
  unchanged in kind by it; a cap would be a new ticket and there is no observed failure.
- **[Error messages, logs, telemetry] No findings.** Nothing is logged on either new path, deliberately:
  the only values a diagnostic could carry are daemon-supplied conversation ids and untrusted prompt
  text, and `clearPairingScopedState`'s no-diagnostic property is total — even a content-free count of
  what was dropped stays unwritten. One incidental note, not to be relied on: `reduceModal`'s
  `assertNever` stringifies an unhandled event, and `JSON.stringify` renders a `Set` as `{}` rather than
  its members. That is an accident of the serialiser, not a control; the control is that a well-formed
  `reconnected` never reaches `assertNever` and that nothing on this path logs.
- **[Concurrency] Checked, no findings.** The one check-then-act is reading `conversationListStore` then
  writing `modalStore`, and both happen in the same synchronous daemon-event dispatch with no `await`
  between them, so nothing can interleave. The listener-ORDER hazard was checked in code rather than
  assumed: two subscribers see the same `connected`, and if `conversationListBridge` cleared that
  server's slot on the edge, this clear would resolve an empty set and silently no-op on every reconnect
  — scoping that never scopes. It does not: that bridge fires only the list REQUEST on the rising edge
  (`useConversationListRequest`, off session status, not the daemon-event channel), and the only writers
  to `byServer` are `setConversations` on a later `conversationsReceived` reply and
  `clearAllConversations` at the pairing boundary. No new timer, listener or async task; the effect
  cleanup is unchanged, so a StrictMode double-mount still nets one listener.
- **[Threat model alignment] Walked.** *Hostile daemon* — covered by the two trust-boundary findings; it
  can steer nothing through `ack`, and what it can steer through its own conversation list is bounded by
  today's behaviour. *Malicious / on-path relay* — it is content-blind and can drop, delay, reorder or
  duplicate a `connected`; each spurious edge now clears one server's prompts instead of every server's,
  so the relay's leverage strictly decreases. *Renderer compromise reaching the transport* — unchanged:
  this path holds no key, socket or token, and adds no IPC surface for one to reach. *Token theft from
  disk* — not applicable; nothing here is persisted.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06

