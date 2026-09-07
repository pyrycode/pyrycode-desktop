# 1213 — dropping a queued message removes its delivered-looking echo

## Files read

- `src/shared/wire/types.ts` → `QueuedItem`, `QueueStatePayload` — the wire record the new `message_id`
  joins; `ToolResult.result_detail` and `PairedServer.last_seen_ts` are the two optional-field precedents
  this ticket copies verbatim.
- `src/main/transport/inboundMessage.ts` → `parseQueuedItem`, `parseQueueStatePayload`, `optionalString` —
  the fail-closed decoder and the existing helper that makes "absent is a value" a one-line change.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem` (`userText` member), `ThreadEvent`
  (`userText` arm), `reduceTimeline`, `TimelineState`, `fillToolResult` — the single pure reducer both
  timeline stores fold through, and the first-match-only `filled` idiom the removal mirrors.
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage`, `ComposerSendDeps` — mints
  the `message_id` for the wire frame and builds the one echo object handed to both write paths.
- `src/renderer/src/screens/conversation/dropQueuedMessage.ts` → `dropQueuedMessage`,
  `DropQueuedMessageDeps` — today a guarded send and nothing else; the ticket's whole subject.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `QueuedBacklog`, the `onDrop` closure
  beside the `<QueuedBacklog>` mount, `dispatchFor` — the container that owns the conversation id and the
  view that owns the row.
- `docs/knowledge/features/queue-store.md` — the backlog is held **verbatim** from the decode with no
  remap and no validation, so a new wire field reaches `QueuedBacklog` for free; the store is a
  replacement-truth snapshot holder and is not part of this change.
- `e2e/queued-backlog-interrupt.spec.ts` → `capturingQueueInterruptFake`, `dequeueFramesMatching`,
  `QUEUED_A` / `QUEUED_B` / `DELIVERED_TEXT` — the fake-transport twin, and the capture array that lets a
  spec learn the client-minted `message_id` it must plant in the snapshot.
- `e2e/real-claude-queue-drop.spec.ts` — carries a prose comment that this ticket makes false.

## Design source

**Figma:** N/A — echoed from the ticket. This ticket adds no visual: it stops a row being drawn that
should not be there. The queued region, its 50% dimming and the drop control are untouched, and the
design file has no queued-message state at all. The verifier's visual-fidelity check is intentionally
skipped.

## Context

Sending a message while claude is busy draws it twice — once as an ordinary delivered `userText` bubble
in the thread (`submitMessage`'s unconditional optimistic echo) and once as a dimmed row in
`.conversation__queued` (the daemon's `queue_state` snapshot, drawn by `QueuedBacklog`). Two independent
writers, neither aware of the other.

`dropQueuedMessage` sends `dequeue_message` and nothing else. The daemon drops the message and re-sends
the backlog without it, so the queued row disappears and **the timeline echo stays forever** — a
delivered-looking user message claude never saw. The operator's own cancel leaves a permanent lie in the
transcript.

This could not be fixed before because there was no correlation key: the echo carries a client-minted
`message_id` used for the wire frame only, and `QueuedItem` carried none. pyrycode#2092 shipped the key —
every item in a `queue_state` snapshot now names the `message_id` from the `send_message` that produced
it, relayed byte-for-byte. Retaining that id on the echo, and keying the removal off it, is this ticket's
work. Folding the two rows into one is #1214, which consumes the correlation established here.

No ADR is warranted: this threads one optional field through an existing decoder and adds one arm to an
existing reducer. Both patterns are already recorded (`result_detail`, `reset`).

### Size — the file ceiling is knowingly exceeded by one, and the floor is why

Six production files against a ceiling of five. Every other boundary holds: ~690 lines of total written
work (against 800), no new exported type, no state machine, five acceptance criteria, and no consumer
cascade — the new wire field is **optional**, so all 46 existing `QueuedItem` literals across 13 files
stay valid untouched, and only ~6 whole-object echo assertions in `composerSend.test.ts` plus two e2e
fixture sites actually need editing.

The only seam available is plumbing — wire field + decode + carrying the id onto the echo — and its
single consumer is the drop, in the same family. That child would ship no observable behaviour of its
own and could not be verified on its own. Per the floor rule, the floor wins over the ceiling: the slice
is merged back, the overage is stated here, and the ticket is built. Split depth is not the reason —
#1213's parent is #1075 and there is no grandparent, so a split was on the table and was declined on the
floor.

## Design

### 1. The wire field — `QueuedItem.message_id?: string`

Optional on the TypeScript type, exactly as `ToolResult.result_detail` models "a pre-pyrycode#2024
daemon". The daemon ships it non-`omitempty`, but that is the daemon's Go struct; the client must still
decode a pre-#2092 snapshot rather than failing the whole snapshot closed (AC1). Nothing needs the field
to be mandatory, and making it so would break 46 literal constructions for no gain.

`parseQueuedItem` reads it through the existing `optionalString` helper: absent → `undefined`, a
non-string → `WireDecodeError` (the helper's own rule, unchanged). Relayed verbatim — not trimmed, not
re-cased, never minted client-side. `''` decodes as `''` and is a legal value that correlates with
nothing.

The queue store holds the item verbatim with no remap, so the field reaches `QueuedBacklog` with no store
change.

### 2. The echo's id — `ThreadItem`/`ThreadEvent` `userText.messageId?: string`

Optional, following `createdAt` in every respect: assigned unconditionally by the reducer, tested with
`item.messageId === undefined` and never `'messageId' in item`. Absent means the producer minted none —
which no production path does today (`submitMessage` always mints one for the wire), but which a future
history-backfill producer would. An echo with no id correlates with nothing and can never be removed by a
drop, which is the right answer for a backfilled message.

`submitMessage` carries the already-minted `message_id` onto the shared echo object. **The id is minted
once and used twice** — the wire payload and the echo — so the two can never disagree, the same
structural argument `attachments` already makes.

### 3. The removal — one new `ThreadEvent` arm, one reducer arm, zero store changes

```ts
| { type: 'dropUserText'; messageId: string }
```

The third non-content arm, beside `reset` and `reconnected`: a renderer lifecycle control event, never
translated from a wire frame, so `timelineBridge` never produces it.

`reduceTimeline`'s arm removes the **first** `userText` item whose `messageId` strictly equals
`event.messageId`, mirroring `fillToolResult`'s `filled` idiom. Contract:

- Only `kind === 'userText'` items are candidates. No other row can be removed by any input.
- No match → **the same state reference**, following the reducer's same-reference discipline, so an
  unmatched drop churns no selector.
- Every chrome scalar is carried unchanged — `phase`, `stalled`, `apiRetry`, `compacting` **and
  `localSendPending`**.

`localSendPending` deserves its own sentence, because `threadTimeline.ts`'s `userText` arm documents that
it owns the working indicator's local window (#650). This arm is *not* a second `userText` producer, so
that arm's "the arm fired = the composer accepted a submit" reasoning is untouched. It carries
`localSendPending` through rather than clearing it because a drop is not the daemon's word on whether a
turn is running, and because clearing it would hide the working indicator for a *different* message that
is genuinely pending. `stalled` is carried for the reason `userText` and `sessionBoundary` already state:
a renderer-sourced event is not daemon turn activity, so it is not in the clear set.

Both timeline stores fold through this one reducer, so **neither store file changes**.

### 4. The drop path — removal at the click, gated on the send

`dropQueuedMessage(conversation_id, queued_msg_id, message_id, deps)` — the third positional argument in
the same snake_case wire vocabulary as the two beside it, `deps` last. `DropQueuedMessageDeps` gains
`dispatch` and `dispatchFor`, both **required**: this deps object has one production call site plus its
own spec, so requiring them buys a compile error for "forgot to wire it" at the price `dispatchFor` in
`ComposerSendDeps` already paid, and well below the ten-call-site boundary that forced `now` the other
way.

The event object is built once and handed to both writes, exactly as `submitMessage` does — safe because
`reduceTimeline` is pure and always builds fresh arrays.

**Whether the echo goes at the click or on the snapshot that confirms the drop: at the click.** Three
reasons, in order of weight.

1. **The echo is this window's own optimistic write.** `submitMessage` posts it before any daemon
   acknowledgement — even on a send-bridge failure. Undoing a client-owned optimistic write with a
   client-owned removal is symmetric. #296 AC3's non-optimistic ruling stands for the *queued row*, whose
   truth the daemon owns; it does not automatically transfer to a row the daemon never authored, and the
   queued row's behaviour is unchanged here.
2. **There is nothing to wait for.** `dequeue_message` has no reject path. Confirming on the snapshot
   would mean inferring "dropped" from a backlog diff, which the ticket forbids for good reason — a
   backlog also shrinks when the daemon *drains* it, and a diff-driven removal would delete the echo of
   every message that ran normally (AC4).
3. **The alternative needs a ledger.** Confirming without a diff would require a pending-drop set keyed
   by `message_id`, held across an async boundary, reconciled against the next snapshot, and expired on
   some timeout nobody has a value for. That is new state for a case the wire cannot even report.

The cost, stated plainly: a drop the daemon ignores (an out-of-range `queued_msg_id`) leaves this
window's transcript missing a row the daemon still holds, until the next snapshot — which will re-draw
the queued row but cannot restore the echo. This is bounded to display and is strictly better than
today's permanent lie in the opposite direction.

**Gated on the send actually going.** `sendCommand` is already wrapped in a `try`/`catch` that swallows a
bridge failure. When it throws, the daemon received nothing, the message is still queued and will still
run, so the removal is skipped and the echo stays — the honest state, and the same `sent` discipline
`submitMessage` uses to keep the echo's attachments from claiming a frame that never went.

**The empty-id rule lives here, at the single producer.** The removal is dispatched only when
`message_id` is a non-empty string. An item carrying no id, or an empty one, correlates with nothing:
its drop sends the `dequeue_message` frame as before and removes no echo (AC1). No second guard in the
reducer — `undefined === ''` is false, so an id-less echo is already unreachable, and a redundant check
would be a defence for a failure mode this producer makes impossible.

### 5. The view — `QueuedBacklog`'s `onDrop` gains the row's `message_id`

`onDrop: (queuedMsgId: number, messageId: string | undefined) => void`. Two positional values rather than
the whole `QueuedItem`, so the container is handed exactly what it needs and never `text` or `ts`. The
conversation-id wall is unchanged: the view still never sees a conversation id, the container still owns
it. The container's closure forwards both into `dropQueuedMessage` and adds `dispatch` / `dispatchFor` to
the injected deps, alongside the `window.pyry.sendCommand` it already dereferences at interaction time.

## State + concurrency model

No new store, no new slice, no new subscription, no async work. The whole removal is synchronous inside
the click handler: `sendCommand`, then two synchronous store writes through the one pure reducer. There
is no `await` in the path, so there is no check-then-act gap and no cancellation path to define — the
existing `AbortSignal` discipline governs the transport, which this ticket does not touch.

The two writes are the same pair `submitMessage` performs and for the same reason (#756): the flat
`timelineStore` holds the open conversation's thread, the keyed `conversationTimelineStore` holds the
per-conversation copy, and a removal reaching only one would leave the other holding the lie so that
switching away and back would bring it back (AC2).

## Error handling

- **Decode.** A non-string `message_id` throws `WireDecodeError` and fails the snapshot closed, the
  helper's existing rule. An **absent** field is a value, not an error (AC1) — a pre-#2092 daemon still
  decodes.
- **Send.** Unchanged: a bridge failure is caught, logged content-free, and never propagated. It now also
  suppresses the removal, per § 4.
- **No match.** Not an error at all — the reducer returns the same state reference. A queued row whose id
  matches no local echo (another device's send, or another device's drop) is a supported state, not a
  failure.

Logging: nothing new is logged. The existing `console.error('drop queued message send failed', error)`
names the category only and carries no id, no text and no conversation id; that stays true.

## Testing strategy

**vitest, node environment, static renders only.** The removal is a pure function of state, so the
behaviour is unit-testable; the click belongs in `e2e/`.

- `inboundMessage.test.ts` — `parseQueuedItem` through a `queue_state` frame: with `message_id` (relayed
  verbatim, including a value that would differ if trimmed or re-cased); **without** it (decodes,
  `message_id === undefined`, snapshot intact — AC1's pre-#2092 case); with `''` (decodes as `''`); with
  a non-string (throws, snapshot fails closed).
- `threadTimeline.test.ts` — the `dropUserText` arm: removes the matching echo and only it; **two
  identical texts with distinct ids — dropping the first leaves the second, correctly attributed, and no
  other row moves** (AC3); an unmatched id returns the *same state reference*; an echo with no
  `messageId` is never removed, including against an `''` event; non-`userText` rows are never candidates;
  `localSendPending`, `stalled`, `apiRetry`, `compacting` and `phase` all carried unchanged; and the
  `userText` arm still carries `messageId` onto the item verbatim.
- `dropQueuedMessage.test.ts` — sends the `dequeue_message` frame unchanged; dispatches the removal to
  **both** `dispatch` and `dispatchFor` with the *same object reference* and the conversation's id; skips
  the removal when `message_id` is `undefined` or `''` while still sending; skips it when `sendCommand`
  throws (and still does not propagate).
- `composerSend.test.ts` — the echo carries `messageId` equal to the `message_id` on the wire payload
  (one mint, two uses). ~6 existing whole-object echo assertions gain the field.
- `e2e/queued-backlog-interrupt.spec.ts` (fake tier) — the end-to-end wiring. A second composer send
  plants a correlatable echo; the spec reads that send's `message_id` off the captured envelope and
  plants it in the pushed `queue_state`, which is the only way to correlate against a client-minted id.
  After the drop the **positive** `dequeueFramesMatching(...) === 1` poll runs first — the drop's own
  effect, unreachable from the pre-click state — and only then the echo's absence is asserted, alongside
  the untouched control echo. The `QueuedItem` fixture literals gain the field by hand: nothing
  typechecks `e2e/`, so a stale fixture would compile, run, and silently fail to correlate.
- `e2e/real-claude-queue-drop.spec.ts` (real tier, `needs-real-claude`) — the prose comment calling the
  duplicate echo "expected and harmless" becomes false and is rewritten; the spec asserts msg2's
  delivered echo is present before the drop and gone after, and that msg1's echo is untouched. The
  existing `queuedBubbles` 1 → 0 mutation-check is the positive wait in front of it. The existing file is
  updated rather than a new `real-*` spec added, which would drift
  `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED`.

Fakes over mocks at the transport boundary; plain spies for the injected `dispatch` / `dispatchFor` /
`sendCommand`, following the sibling guarded-send specs.

## Open questions

1. **Does `QueuedBacklog` take two positional arguments or the whole `QueuedItem`?** Resolved in § 5 —
   two, to keep the container's surface minimal. Recorded here because the alternative is defensible and
   #1214 may revisit it when it folds the two rows.
2. **Does the real-claude spec's added assertion need a longer settle window?** The drop's DOM effect is
   synchronous in the renderer once the click lands, so no; confirm against the existing
   `TURN_TIMEOUT_MS` gates during implementation and record any change here.

## Security review

**Verdict:** PASS

**Findings:**

**1. Trust boundaries — the correlation key is attacker-influenced, and is compared, never indexed.**
`message_id` crosses three boundaries: relay socket → `parseQueuedItem` in the main process → IPC →
renderer store → `dropQueuedMessage`. It is untrusted at every one: it arrives from another client
through a content-blind relay and is relayed byte-for-byte by a daemon that does not author it. The
boundary is explicit and single — `parseQueuedItem` is the only place a `QueuedItem` is constructed from
wire bytes, and `optionalString` is the only narrowing.

Downstream it is read for **strict string equality only** (`item.messageId === event.messageId`). It is
never a lookup path, a cache key, a filename, a URL, a `Map` key, an object index or a React `key` (the
row key stays `queued_msg_id`), and it is never rendered — so there is no prototype-pollution surface, no
path-traversal surface and no DOM sink. This is stated as the field's contract in its own docblock so a
later consumer inherits it rather than rediscovering it.

**2. A hostile daemon could aim a drop at a delivered message's echo — bounded, and below its existing
capability.** The `message_id` of a message that already ran is known to the daemon (it rode the
`send_message` frame). A compromised daemon could therefore emit a `queue_state` item carrying that id;
if the operator then clicks drop on that row, this client removes a delivered echo. Impact is confined to
this window's display: one `userText` row per click, first-match only, no other row kind reachable, no
persistence, no wire effect beyond the `dequeue_message` the operator asked for. A daemon in that
position already streams arbitrary assistant text into the transcript, so *removing* a row is strictly
less capable than what it can already write. **Not a MUST FIX**, and no client-side check can distinguish
the case — the daemon is the only authority on what is queued. Recorded so #1214 inherits the reasoning
rather than re-deriving it.

**3. A hostile or degraded relay can replay a stale snapshot — named, and out of scope.** The relay is
content-blind but on-path: it can drop, delay and reorder frames, so a stale `queue_state` can draw a row
for a message that has since run. A drop clicked on that row sends a `dequeue_message` the daemon no-ops
and removes an echo whose message actually ran. Confirming on the next snapshot would not fix it (the
snapshot cannot distinguish drained from dropped — the ticket's own finding, and § 4's second reason),
and the failure needs both a hostile/degraded relay and an operator click. **OUT OF SCOPE**, in the same
class as the ticket's stated "another device's drop" gap; #1214 owns the merged-row design where the two
rows can no longer disagree.

**4. Unbounded field length — considered, declined, with the bound named.** `optionalString` imposes no
length cap, so a hostile daemon could send a megabyte `message_id`. It is never rendered, never allocated
into a keyed structure and only compared, and the inbound frame is already capped by `maxPayload` on the
relay socket (`relayConnection.ts`, `maxFrameBytes`), which bounds the whole snapshot. Adding a
per-field cap here would defend an unobserved failure mode behind an existing deterministic bound.
No change.

**5. Tokens, secrets, storage, crypto — not applicable, by design decision.** No secret, token or key is
read, minted, stored or compared anywhere in this change. `message_id` is a `crypto.randomUUID()` value
minted in the container today (unchanged by this ticket) and is **not** a secret: it already travels on
the wire inside `send_message` by design, and no security property rests on its unguessability — a wrong
guess by an attacker who is already the daemon achieves finding 2, which is bounded there. Nothing is
written to disk, nothing touches `safeStorage`, no renderer web storage is used, and no cryptographic
primitive is added, selected or re-implemented.

**6. Electron / IPC attack surface — no new surface.** No `contextBridge` API, no `ipcMain` channel, no
`webPreferences`, no protocol handler, no navigation and no window-open path is added or altered. The
`dequeue_message` command and its payload are byte-identical to today's. The decoder stays in the main
process and the renderer receives an already-typed optional string, so the process wall that keeps keys
and sockets out of the web layer is untouched.

**7. Logs and error messages — nothing new reaches a log, and the existing line stays content-free.**
This change adds no log call. `dropQueuedMessage`'s existing `console.error('drop queued message send
failed', error)` names the category only and carries no `message_id`, no `text` and no conversation id;
the removal is added *below* it and does not widen it. `message_id` is untrusted transit content on the
same terms as `text` and is explicitly barred from the log, per the repo's content-free-logging rule.

**8. Concurrency — no async, so no cancellation or race surface.** The path is synchronous end to end:
one guarded send, then two synchronous store writes through a pure reducer. No timer, no listener, no
promise, no shared state read across an `await`, nothing that outlives the click. The removal is
idempotent — a second `dropUserText` for the same id finds no match and returns the same state reference
— so a double-click removes one row, not two.

**9. Hostile daemon response parsing — covered by the existing fail-closed decoder.** The new field is
narrowed by `optionalString`, which rejects every non-string type (including objects, arrays and `null`)
with a `WireDecodeError` that fails the whole snapshot closed. `''` and absence are both accepted as
values and both correlate with nothing, which is the AC1 requirement and also the safe direction: an
ambiguous id removes no row rather than the wrong one.
