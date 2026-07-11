# Spec #275 — Reflect `conversation_updated` in the live Channel List

Keep the Channel List live: when the daemon broadcasts a `conversation_updated`, re-request the
authoritative conversation list so the affected row's new `is_promoted` value lands in
`conversationListStore` — and, via the store's existing partition, the row moves from the Recent tier
to the Channels tier with **no view change**.

Split from #143. The transport half (#273) is merged: the `conversationUpdated` `DaemonEvent` arm and
all three `assertNever` bridge no-ops already exist. This ticket adds the single consumer.

## Files to read first

- `src/renderer/src/store/conversationListBridge.ts` (whole, 106 lines) — **the only production file
  you edit.** Study the four members: the pure filter `translateConversationsEvent` (leave it
  untouched), the bare command `requestConversationList`, the subscription `subscribeConversations`
  (you extend it), and the app-level React binding `ConversationListData` (you update its one call
  site). Note the file header's design creed: "React-free and injected, so the whole path is
  unit-testable with plain spies."
- `src/renderer/src/store/conversationListBridge.test.ts` (whole, 166 lines) — **the test file you
  extend.** Reuse its `fakeBridge()` helper (captures the listener, hands back an `off` spy) and its
  real-store "not-loaded → loaded" idiom (`createConversationListStore` + `selectConversations`).
- `src/shared/ipc/events.ts:143-151` — the `conversationUpdated` arm and the untrusted-string
  constraint it carries. Confirm the arm shape: `{ type: 'conversationUpdated'; conversation:
  ConversationUpdatedPayload }`.
- `src/renderer/src/store/conversationListStore.ts:26-53` — `setConversations` replaces the whole
  array unconditionally ("most recent list wins", AC2 of #208). This is why re-request is drift-free:
  the daemon's authoritative reply overwrites, no merge/dedup needed.
- `src/renderer/src/screens/channels/channelListViewModel.ts:26-34` — `partitionByPromotion`
  (order-preserving `is_promoted` filters). **AC2's tier move is exercised through this, unchanged** —
  once the store holds the flipped row, the partition puts it in `channels`. Do not touch it.
- `src/shared/ipc/commands.ts:75` — the bare `{ type: 'requestConversations' }` command (no payload).
  The re-request reuses it verbatim; no new command member.
- `src/renderer/src/App.tsx:99-113` — where `<ConversationListData />` is mounted app-level (a headless
  sibling of `SessionIdData` / `RunSettingsWriteData`). Context only — **no change to App.tsx.**

## Context

Today `ConversationListData` requests `list_conversations` exactly once per connection episode — on
the rising edge to `connected` (`conversationListBridge.ts:95-103`). Its own comment names this ticket
as the deferred follow-up ("*NOT the deferred richer refresh policy … a future `conversation_updated`*").
So a live promotion (or any daemon-side conversation change) is invisible until the next reconnect.

When a discussion is promoted (#274, the first producer, not yet landed), the daemon fans out an
**unsolicited** `conversation_updated` broadcast with `is_promoted: true`. #273 decodes it into the
typed `conversationUpdated` `DaemonEvent`. This ticket makes the list react to that event so the row
moves into the Channels tier without reopening the app. It is not promote-specific: rename / archive /
delete all emit the same `conversation_updated`, so this is the general "keep the list live" path.

## Design source

N/A — data-path change only. This ticket adds **no** new component, view, or DOM sink. AC2's visible
outcome (a row appearing in the Channels tier) is produced entirely by #141's existing
`partitionByPromotion` render once the store holds the flipped row — there is nothing to draw and no
Figma node to reproduce. Code-review's visual-fidelity check is intentionally not applicable here.

## Design

**Mechanism: re-request** (the ticket's recommended path, over an in-place store patch). On a
`conversationUpdated`, fire the existing bare `list_conversations` request. The daemon returns the
authoritative, ordered list; the arriving `conversationsReceived` overwrites the store via the existing
`setConversations` whole-array-replace. This is drift-free, idempotent, and generalizes to
rename/archive/delete. It sidesteps every concern an in-place patch would carry (unknown-id
reconciliation, self-broadcast dedup, daemon-ordering drift) — see § State + concurrency.

Three edits, all in `conversationListBridge.ts`. `translateConversationsEvent` is **not** one of them:
the re-request trigger is a distinct concern kept out of that pure `event → rows | null` filter.

### 1. New exported pure predicate — the refresh trigger (distinct from the filter)

```ts
/** Should this event trigger a list re-request? True only for the conversation-updated broadcast.
 *  Deliberately a boolean, NOT a type guard that narrows to the payload: AC3 — the event's
 *  id / name / cwd are never consulted. We react to the OCCURRENCE of a daemon-side change, then let
 *  the daemon's authoritative reply land the new rows. Separate from translateConversationsEvent so
 *  the pure "rows" filter stays single-purpose (the ticket's "don't overload that filter"). */
export function isConversationUpdated(event: DaemonEvent): boolean
```

Body is a one-line `event.type === 'conversationUpdated'`. A boolean (not `event is Extract<…>`) is
the deliberate signal that the payload is unused — the invariant AC3 asserts.

### 2. Extend `subscribeConversations` — one listener, two independent reactions

Add a third injected dependency, `refreshOnChange: () => void`. The single `onDaemonEvent` listener now
has two independent `if` branches (a single event is never both a `conversationsReceived` and a
`conversationUpdated`, so they never cross-fire):

```ts
export function subscribeConversations(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setConversations: (conversations: readonly ConversationSummary[]) => void,
  refreshOnChange: () => void
): () => void
// listener body:
//   const list = translateConversationsEvent(event)
//   if (list !== null) setConversations(list)          // existing — write rows
//   if (isConversationUpdated(event)) refreshOnChange() // new — trigger re-request
```

Still exactly one `onDaemonEvent` subscription (AC4). `refreshOnChange` is a required param — the
listener always needs to know what to do on an update; making it required keeps the contract honest and
forces the one production call site + the existing tests to opt in explicitly.

### 3. Bind the refresh at the one call site in `ConversationListData`

The subscribe effect (empty deps, app-lifetime) passes the re-request as the third arg, reusing the
existing `requestConversationList` + `sendCommand`:

```ts
return subscribeConversations(
  window.pyry.onDaemonEvent,
  (list) => conversationListStore.getState().setConversations(list),
  () => requestConversationList(window.pyry.sendCommand)
)
```

`window.pyry.sendCommand` is dereferenced **only when the arrow runs** (i.e. when a
`conversationUpdated` fires), never during render — so the existing "server-renders to empty markup
without touching `window.pyry`" test is unaffected. The initial-request effect
(`isConnected` + `requested` ref, lines 88-103) is untouched: the re-request is a separate, ungated
reaction to the event stream, not part of the connect-once path.

## State + concurrency model

- **Single source of state.** `conversationListStore` remains the one source of truth; the re-request
  path writes it only through the existing `conversationsReceived → setConversations` seam. No parallel
  state, no in-place mutation of stored rows.
- **One listener, app-lifetime.** No second `onDaemonEvent` subscription is introduced (AC4). The
  StrictMode-safe exactly-one-live-listener guarantee comes, as before, from the empty-dep effect +
  off-handle cleanup on the single subscription — not from component unmount (`ConversationListData`
  is mounted app-level in `App.tsx` and is app-lifetime by design; there is no unpair teardown to
  model). The earlier draft's `useConversationCreatedNav` off-handle precedent is the *wrong* one and
  is not used here.
- **No feedback loop.** Re-request → daemon `conversations` reply → `conversationsReceived` → store
  write. `conversationsReceived` does not re-emit `conversationUpdated`, so the loop terminates in one
  hop.
- **Self-broadcast is a non-issue.** When this client promotes (#274) and the daemon broadcasts
  `conversation_updated` back to it, the re-request returns the authoritative list; the
  whole-array-replace makes arrival idempotent. No dedup, no spurious-id reconciliation — the exact
  concern #273 flagged as "#275's concern," dissolved by choosing re-request.
- **No coalescing.** Rapid successive updates each fire their own re-request. Debouncing/coalescing is
  a deferred optimization, explicitly not required for correctness (ticket Technical Notes). Do not add
  it — evidence-based: no observed thrash.
- **No connected-gate on the re-request.** A `conversationUpdated` can only arrive over a live
  connection, so connectedness is implicit; `sendCommand` is fire-and-forget `void` and degrades
  silently even in the impossible post-disconnect race. Do not read session-store state inside the
  listener.

## Error handling

- The listener never throws into React (AC3). Its only new action is
  `requestConversationList(window.pyry.sendCommand)` → `sendCommand({ type: 'requestConversations' })`,
  a fire-and-forget `void` with no result to await and no throw path (the composer-send idiom).
- `isConversationUpdated` is a total pure function over the sealed union — no failure mode.
- Under re-request the event's `id` is never consulted, so "an event referencing an unknown
  conversation id" cannot mis-target anything — it simply triggers a full refresh (AC3's in-place-patch
  caveat does not apply to the chosen mechanism).
- **Untrusted-string inheritance.** `ConversationUpdatedPayload.name` / `.cwd` are untrusted
  daemon-supplied strings. This ticket adds no DOM sink (it doesn't read the payload at all); rendering
  stays #141's existing plain-text path. The "render as plain text, never HTML" constraint carried on
  the arm in `events.ts` continues to hold downstream — do not introduce `innerHTML` /
  `dangerouslySetInnerHTML`.

## Testing strategy

`npm test` (vitest), extending `conversationListBridge.test.ts` with plain spies — no React, no
Electron (the file's established idiom). Bullet scenarios (developer writes them in the house idiom):

- **`isConversationUpdated` (new `describe`)**
  - Returns `true` for a `{ type: 'conversationUpdated', conversation: <payload> }` event.
  - Returns `false` for a sample of unrelated events (`conversationsReceived`, `connecting`,
    `conversationCreated`) — mirrors the existing "unrelated events" table test for the filter.
- **`subscribeConversations` re-request behavior (extend the existing `describe`)**
  - On a `conversationUpdated` event: `refreshOnChange` spy is called exactly once, and
    `setConversations` is **not** called (an update event carries no rows to write — it only triggers
    a re-request).
  - On a `conversationsReceived` event: `setConversations` is called and `refreshOnChange` is **not**
    (the two concerns don't cross-fire).
  - On an unrelated event (e.g. `connecting`): neither spy is called.
  - Still exactly one `onDaemonEvent` subscription (extend the existing `subscribeCalls() === 1`
    assertion to the new arity).
  - The existing tests that call `subscribeConversations` with two args get a throwaway third spy
    (`vi.fn()`); they otherwise assert unchanged behavior.
- **End-to-end flip through the real store + `partitionByPromotion` (AC1 + AC2, one integration test)**
  - Wire `subscribeConversations` to a real `createConversationListStore()` (the existing
    "not-loaded → loaded" idiom) and a `refreshOnChange` spy.
  - Seed the store with a row where `is_promoted: false` (emit a `conversationsReceived`); assert
    `partitionByPromotion(rows)` puts it in `discussions`.
  - Emit a `conversationUpdated` for that id; assert `refreshOnChange` fired (the re-request).
  - Emit the daemon's authoritative reply — a `conversationsReceived` whose row now has
    `is_promoted: true`; assert the store reflects the flip and `partitionByPromotion(rows)` now puts
    the row in `channels` and no longer in `discussions`. This proves the full seam without rendering.
- **`ConversationListData` server-render** — the existing "server-renders to empty markup without
  touching `window.pyry`" test must still pass unchanged (the third arg only defers a `window.pyry`
  deref into the event-fired closure). Effect timing (deps/ref/StrictMode) stays verified by inspection
  against the existing one-shot-ref idiom, not unit-tested.

Type coverage: `npm run typecheck`. The required third param makes the one production call site and the
test call sites fail to compile until updated — the compiler enforces the migration.

## Open questions

None blocking. Two deliberately-deferred items, both out of scope and not to be built here:
- **Coalescing** rapid `conversation_updated` bursts into one re-request — deferred optimization.
- **Refreshing on `conversationCreated`** (a newly-created row appearing without reconnect) — a
  separate arm and a separate concern (#241/#242 territory); this ticket is `conversationUpdated` only.
