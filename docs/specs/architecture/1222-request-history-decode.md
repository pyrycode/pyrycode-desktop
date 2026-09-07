# #1222 — ask the daemon for a page of conversation history and decode the reply

The transport leg of conversation scroll-back: an outbound `request_history` frame, a decoded
`history_page` reply, and the five published refusals reaching the window as a typed failure.
Nothing asks for a page (#1224), nothing renders one (#1223), nothing reduces or dedupes one
(#1225).

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `RequestModelListPayload`, `MessagePayload` — the
  member-comment shape a new verb pair takes, and the payload doc conventions the three new types
  mirror. `MessagePayload` exists already; this ticket mints no duplicate of it.
- `src/main/transport/requestModelListEnvelope.ts` → `buildRequestModelList`,
  `RequestModelListInput` — the bare-request builder template, including the "fresh literal, never a
  spread of the caller's object" rule that bounds the outbound wire.
- `src/main/transport/requestSessionSettingsEnvelope.ts` → `buildRequestSessionSettings` — the
  `?? ''` normalisation that keeps an omitted value honest on a no-`omitempty` wire. AC1 names it as
  the precedent for `limit`'s normalisation.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`, `parseInboundMessage`,
  `requireString` / `requireNumber` / `requireBoolean` / `requireStringArray`, `optionalStringMap`,
  `narrowDaemonErrorOutcome`, `DaemonErrorOutcome`, `RESERVED_MAP_KEYS` — the decode boundary this
  extends, the helper family a new parser must reuse rather than reinvent, and the closed-enum
  comparand idiom AC4 requires.
- `src/main/transport/attachmentTransfer.ts` → `AttachmentTransferFailure` — **the reason
  `DaemonErrorOutcome` is not widened here**; see § Design. It inherits that union whole.
- `src/shared/ipc/attachmentUpload.ts` → `AttachmentUploadFailure` — the mechanical mirror of the
  same union across the IPC boundary, and the second reason not to widen it.
- `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` — the renderer copy table keyed on
  that mirror; a widened `DaemonErrorOutcome` would demand composer copy for a history reject.
- `src/main/daemonConnection.ts` → `pendingSettings`, `pendingCreateFolders`,
  `pendingConfigRequests`, `requestSessionSettings`, `requestModelList`, the `daemon-error` and
  `session-settings` inbound arms, `dial` — the correlation-map idiom, its set-after-a-successful-send
  ordering, and the fail-closed correlation gate this copies field for field.
- `src/shared/ipc/events.ts` → `DaemonEvent`, `runConfigReceived`, `DebugBundleFailure` — the union
  the two new arms join, the client-owned-`conversationId` provenance argument `historyPageReceived`
  inherits, and the closed-enum-reason-on-an-event precedent (`debugBundleFailed`).
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isRequestModelListPayload`
  — the command member and boundary guard shape.
- `src/main/index.ts` → the `onCommand` switch's `requestModelList` case — conversation-routed
  dispatch, one local read twice.
- `src/main/connectionRegistry.ts` → `ActiveConnection`, `viewOf` — the delegate list written exactly
  once.
- `src/renderer/src/store/timelineBridge.ts`, `daemonEventBridge.ts`, `modalBridge.ts`,
  `questionBridge.ts` → `timelineWriteTarget`, `routeDaemonEvent`, `translateModalEvent`,
  `translateQuestionEvent` — the four `DaemonEvent` switches ending in `assertNever`, derived by
  grepping `assertNever` across `src/` rather than from the ticket's prose. All four take null arms.
- `docs/knowledge/features/inbound-message-decode.md` — the fail-closed / content-free-log posture
  and the no-client-invented-bound rule AC5 turns on.
- `docs/knowledge/features/daemon-connection-correlation.md` — the four existing correlation stores,
  their reset-on-`dial()` rule, and the stale-entry reasoning behind set-after-send.
- Daemon SSOT: `pyrycode` `docs/protocol-mobile.md` § *Conversation history (v2)* — read in full,
  including § *Page size*, § *The cursor*, § *A history entry* and § *Rejects*.

## Context

A conversation opened today shows nothing that happened before this client connected. The daemon
half landed (pyrycode#2112 the on-disk log, #2113 the verb pair, #2116 the handler). This slice
teaches the desktop transport to ask and to decode the answer, and stops there.

The one fact that shapes every piece: **a `history_page` carries no `conversation_id`**. Which
conversation a page describes is knowable only from which envelope it answers, so the requester keeps
its outstanding asks keyed by envelope id and the conversation id that crosses to the window is
**client-owned** — the id this app put in its own outbound frame, never a string parsed off the
network. That is exactly `pendingConfigRequests`' argument for `session_settings`, and this reuses it.

No ADR is warranted: this is the twenty-sixth additive extension of an established boundary, and
every decision below is an instance of a rule already recorded in `inbound-message-decode.md` or
`daemon-connection-correlation.md`.

### Sizing — over the file line, deliberately

Re-counted against this written plan: **12 production source files** (11 modified, 1 new) against the
table's 5. Every other line holds — 3 new exported types (≤5), 6 consumer call sites (≤10), 5
acceptance criteria (≤5), 5 reject branches plus one catch-all (≤10), ~700 lines of total written
work (≤800).

The floor rule decides it, and the refiner's `Estimate:` line reached the same conclusion
independently. A verb's outbound and inbound halves have exactly one consumer each — each other,
through the `in_reply_to` correlation — so a split produces a child nothing outside the family calls.
And the breach survives the split anyway: any ticket adding a `DaemonEvent` arm must touch the four
exhaustiveness bridges plus `types.ts`, `events.ts`, `inboundMessage.ts` and `daemonConnection.ts`,
so the inbound half alone is 8 files. Cutting the request half off buys a second ticket and leaves
the larger child still over the line. Split depth is 1 (parent #1088, no grandparent), so a split was
available and was declined on the floor, not blocked on the cap.

## Design

### Wire types — `src/shared/wire/types.ts`

Three interfaces plus two `EnvelopeType` members, each comment naming § *Conversation history (v2)*
of the daemon's `docs/protocol-mobile.md`.

- `RequestHistoryPayload` — `conversation_id: string`, `cursor: string`, `limit: number`. All three
  required: the daemon declares no `omitempty`, so every key is always on the wire.
- `HistoryEntry` — `id: number`, `type: string`, `payload: Record<string, unknown>`, `ts: string`.
  `type` is a stored string nothing re-validates, so it is **not** narrowed to a closed set and an
  unrecognised one is ordinary data. `id` is the durable on-disk log id and carries a doc warning
  that it is not an `event_id` and the two must never be joined.
- `HistoryPagePayload` — `entries: HistoryEntry[]`, `cursor: string`, `at_start: boolean`.
  No `conversation_id`, and the comment says why that is a decision rather than an omission.

`payload` is `Record<string, unknown>` rather than a narrowed union: it crosses verbatim as opaque
data, interpreted nowhere in this ticket, and #1223 owns the reduction. `MessagePayload` is named in
the comment so no one mints a duplicate; nothing here narrows an entry into it.

### Outbound — `src/main/transport/requestHistoryEnvelope.ts` (new)

`buildRequestHistory(input: RequestHistoryInput): Uint8Array`, mirroring `buildRequestModelList`:
a fresh three-key literal, never a spread of the caller's object, so a field smuggled past the
boundary guard is dropped here rather than sent.

`RequestHistoryInput` = `{ id: number; ts: string; conversationId: string; cursor: string; limit?: number }`.

- `cursor` crosses **verbatim** — never parsed, never rewritten, never inspected. `''` is the normal
  opening value of a walk, not a missing one, so there is no non-empty check and no normalisation.
- `limit` normalises to `0` when absent or not a finite number greater than zero. `0` is the
  published "daemon chooses" value and never means zero entries; a negative limit is a reject, so
  the builder never emits one. The `Number.isFinite` clause exists because `JSON.stringify` writes
  `NaN`/`Infinity` as `null`, which would break the always-a-number contract. No upper clamp — the
  daemon clamps at `history.MaxPageEntries`, and a client-side ceiling would be a second bound to
  keep in agreement (AC5).
- A non-integer `limit` is deliberately not floored. Every call site supplies an integer literal, and
  the daemon answers a malformed payload with `history.invalid_request`, which this slice now
  surfaces as a typed failure — so the failure mode is observable rather than silently repaired.

### Inbound decode — `src/main/transport/inboundMessage.ts`

New `InboundDaemonMessage` member:
`{ kind: 'history-page'; historyPage: HistoryPagePayload; inReplyTo?: number }` — `inReplyTo`
optional, like `session-settings` and unlike `attachment-chunk`, because correlation failing closed
one layer up is the desired behaviour rather than a malformed frame.

Parsers, each reusing the existing helper family:

- `requireRecord(payload, field): Record<string, unknown>` — a new one-field helper, the structural
  minimum `isRecord` already expresses, applied to a named field. Needed because no existing helper
  narrows an opaque nested object: `optionalStringMap` requires string values, and an entry's payload
  is arbitrary JSON.
- `parseHistoryEntry(raw): HistoryEntry` — `isRecord` guard, then `requireNumber('id')`,
  `requireString('type')`, `requireRecord('payload')`, `requireString('ts')`. Returns a fresh
  four-key literal so nothing extra rides along. `payload` is carried **by reference**, unparsed.
- `parseHistoryPagePayload(payload): HistoryPagePayload` — `Array.isArray(entries)` then
  `.map(parseHistoryEntry)` (one bad element fails the whole payload closed, `[]` is valid, the
  result is a fresh array), `requireString('cursor')` — **not** `requireNonEmptyString`, since the
  cursor is empty whenever `at_start` is true — and `requireBoolean('at_start')`.
- **No count bound and no size bound.** `MAX_PLAINTEXT_BYTES` at the top of `parseInboundMessage`
  already fails an oversized frame before any parse, and the daemon clamps the entry count at
  construction and re-asks a too-large page rather than truncating it. A count bound below 4096 would
  drop valid pages (AC5, the `parseBackgroundTaskRosterPayload` posture).

`entries` and `cursor` are carried as sent. Nothing normalises a short or empty page into an
end-of-log flag: `at_start` is the only termination signal, and nothing here acts on either field.

The switch case narrows **before** logging, then emits the existing content-free record
(`event: 'inbound-decoded'`, `code: 'history_page'`, byte length, one-way hash). No cursor, no entry
payload, no entry type, no `id` reaches a log line.

### The reject path — a second narrower, not a widened `DaemonErrorOutcome`

**This is the one place the plan departs from the obvious reading of the ticket, and it is
load-bearing.** AC4 points at the closed-enum comparand idiom, and `narrowDaemonErrorOutcome` is
that idiom's home — but `DaemonErrorOutcome` is not a free-standing vocabulary. `AttachmentTransferFailure`
inherits it **whole**, `AttachmentUploadFailure` mirrors that mechanically across IPC, and
`attachmentUploadCopy` is a renderer copy table keyed on the mirror. Adding `history.invalid_cursor`
to `DaemonErrorOutcome` therefore lands it in the attachment-upload failure union and demands
composer copy for a failure no upload can produce. That cascade is both wrong and outside this
ticket's scope.

So the history codes get their own narrower beside it, mirroring its every property:

```ts
export type HistoryRejectReason =
  | 'conversation-not-found'
  | 'history-invalid-request'
  | 'history-invalid-page-size'
  | 'history-invalid-cursor'
  | 'history-unavailable'

function narrowHistoryRejectReason(payload: unknown): HistoryRejectReason | undefined
```

Total by construction, never throws — an `error` frame is terminal because it arrived, not because
its payload parsed, and the four existing `daemon-error` consumers must still fire for every one.
The `switch` **is** the trust boundary: it compares the untrusted string against client-owned
constants and returns a client-owned constant; the daemon's string is never an index, a join, a
resolve or a retained value.

The `daemon-error` kind grows one **optional** field: `historyReject?: HistoryRejectReason`.
Optional, where its `outcome` sibling is required, and the divergence is deliberate: `outcome` is
required so no consumer has a field-missing state to mishandle, while here absence has exactly one
meaning ("this code is outside the published history set") read at exactly one emit, which maps it to
a `'unclassified'` member on the IPC event. Keeping it optional also avoids reddening eleven existing
`daemon-error` assertions for no behavioural gain.

### IPC events — `src/shared/ipc/events.ts`

```ts
export type HistoryRequestFailure =
  | 'conversation-not-found' | 'history-invalid-request' | 'history-invalid-page-size'
  | 'history-invalid-cursor' | 'history-unavailable' | 'unclassified'

| { type: 'historyPageReceived'; conversationId: string
    entries: readonly HistoryEntry[]; cursor: string; atStart: boolean }
| { type: 'historyRequestFailed'; conversationId: string
    reason: HistoryRequestFailure; retryable: boolean }
```

`HistoryRequestFailure` duplicates `HistoryRejectReason`'s members by hand rather than importing it,
because `inboundMessage.ts` is IPC-free by placement rule. That is the same mechanical mirror
`AttachmentUploadFailure` already makes of `DaemonErrorOutcome`, and the same reason.

The sixth member, `'unclassified'`, is not a hedge: § *Page size* publishes a real case where a
correlated refusal falls outside the five. When one stored entry cannot fit in any page the daemon
emits it anyway and **its own transport answers `message.too_long`**, correlated to this client's
`request_history`. A walk that dropped that error would stall with no terminal, so a correlated
refusal always settles the ask.

`retryable` is carried rather than left to the consumer, and this is the deliberate divergence from
`DaemonErrorOutcome`'s stated "retryability is documented, not computed" posture. That posture holds
because the attachment flags live in two upstream files, so no single client-side list could be
right. Here the whole set is one verb's, published in one section, with exactly one retryable member
(`history.unavailable`) — and the consumer that would otherwise re-derive it is a scroll-back walk
driver in the renderer (#1224), which is precisely where a wrong re-derivation becomes a retry loop.
Computing it once, at the emit, is the safer shape. A unit test pins that `'history-unavailable'` is
the only member for which it is true.

`conversationId` on both arms is **client-owned**, carrying `runConfigReceived`'s provenance argument
verbatim: the id this app put in its own outbound frame, held in main-process memory and handed back,
never parsed out of an inbound payload. It is a routing key, not rendered text, and it reaches no log
sink. The numeric `in_reply_to` it was resolved from is **not** carried — the window receives the id
it supplied, never the wire routing id.

### Command channel — `src/shared/ipc/commands.ts`, `src/main/index.ts`, `src/main/connectionRegistry.ts`

- `RendererCommand` gains `{ type: 'requestHistory'; payload: RequestHistoryPayload }`, with
  `isRequestHistoryPayload` checking three present-and-typed fields (`conversation_id` string,
  `cursor` string, `limit` number). Types, not emptiness — `''` is a valid cursor and a valid-if-
  unresolvable conversation id, and the daemon polices ids. Structural minimum, like every sibling:
  an extra field passes here and cannot reach the wire, because the builder rebuilds a fresh literal.
- The `onCommand` case is conversation-routed, mirroring `requestModelList`: one local read twice, so
  the id routed by and the id sent can never be two different expressions.
  `router.route(conversationId)?.requestHistory(command.payload)`.
- `connectionRegistry`'s `viewOf` gains one delegate line. Its docblock's "24 members" numeral goes
  stale on this edit; it becomes "every non-lifecycle member" rather than "25", so the next slice
  does not renumber it again.

### Correlation — `src/main/daemonConnection.ts`

A fifth correlation store: `pendingHistoryRequests = new Map<number, string>()`, envelopeId → the
conversation id the request named. A `Map` for the reason `pendingConfigRequests` is one — there is a
value to carry per entry, its key is a number **this client minted**, and a lookup by exactly one key
is the whole query.

- `requestHistory(payload)` — inert no-op when `driver === null` (the send twin's guard). One local
  for the envelope id, read three times, so the id sent, the id counted and the id recorded can never
  be three different expressions. `nextEnvelopeId` advances only on a successful build; the map entry
  is set **after** a successful `driver.sendMessage`, because an entry left under an unspent id would
  answer whichever request re-mints it, with the wrong conversation. Never throws out of the module;
  the caught object is dropped, and nothing is logged. No retry.
- `case 'history-page'` — the fail-closed correlation gate, copied from the `session-settings` arm.
  An absent `inReplyTo` short-circuits before the lookup; a miss (a stale reply, a duplicate, or a
  hostile daemon forging a page for an ask this client never sent) is dropped entirely, with no
  coercion and no partial event. Both branches are silent: the only values a diagnostic could carry
  are the conversation id and the wire routing id. A hit deletes the entry and emits
  `historyPageReceived` as a fresh named-field literal, never a spread of the decoded payload.
- `case 'daemon-error'` — a fourth member of the existing unique-per-request-envelope-id tier, added
  after the three in place. Order among them is immaterial: an envelope id is minted once, so at most
  one store can hold it. A match consumes the frame entirely — delete the entry, emit
  `historyRequestFailed` with `reason = inbound.historyReject ?? 'unclassified'` and
  `retryable = reason === 'history-unavailable'`, and return before the reassembler and modal-FIFO
  fallbacks below.
- `dial()` clears the map beside its four siblings: a fresh connection recycles envelope ids from 2,
  so a surviving entry would attribute the new connection's first page to the dead one's conversation.

### The four exhaustive bridges

`timelineBridge`, `daemonEventBridge`, `modalBridge`, `questionBridge` each gain two null arms — the
compile-time guard doing its job. The timeline mapping is #1223's; the arms ship **dormant**, not
permanently no-op, and say so. `daemonEventBridge`'s guard stringifies the whole event into an Error
message, so its arms are what keep replayed daemon content off that frame.

## State + concurrency model

One new piece of mutable state: `pendingHistoryRequests`, module-local to the connection closure.
Single-writer — every mutation runs to completion inside a synchronous `requestHistory` /
`onDriverEvent` body, with no `await` between a read and a write, exactly as its four siblings.
Bounded by the number of in-flight asks, drained on every match and cleared on every `dial()`.

No new async task, no timer, no subscription, no `AbortController`: the request is one synchronous
frame write and the reply arrives on the existing driver event stream. There is no deadline on an
outstanding ask — an unanswered one is abandoned at the next `dial()`, which is the same lifetime
`pendingSettings`/`pendingConfigRequests` give theirs, and adding a timeout here would be a client
policy #1224 owns.

## Error handling

| Layer | Result | Failure behaviour |
|---|---|---|
| `buildRequestHistory` | `Uint8Array` | May throw `WireEncodeError` in principle; the sole caller catches and drops, so an over-cap ask fails closed as a dropped send. |
| `parseHistoryPagePayload` | `HistoryPagePayload` | Throws `WireDecodeError` on any malformed shape — non-array `entries`, one bad element, a missing or mistyped field, a non-object entry `payload`. Never a partial page. |
| `parseInboundMessage` | `InboundDaemonMessage \| null` | Oversized frame throws before any parse. The consumer's existing `catch` drops the frame with no event and no log. |
| `narrowHistoryRejectReason` | `HistoryRejectReason \| undefined` | Total; never throws. A non-record payload, an absent `code`, a non-string `code`, or an unrecognised one all yield `undefined`. |
| `case 'history-page'` (consumer) | `void` | Absent or unmatched `inReplyTo` → dropped silently. A hit → exactly one `DaemonEvent`. |
| `case 'daemon-error'` (consumer) | `void` | A correlated refusal always settles the ask, including a code outside the five (`'unclassified'`). |
| Window | — | Nothing yet: both arms are dormant across all four bridges. #1223/#1224 are the first consumers. |

## Testing strategy

All vitest; no Playwright spec, because nothing in the window reaches this path in this slice.

- `requestHistoryEnvelope.test.ts` (new) — real codec bytes, decoded back: all three keys always
  present; an empty cursor is emitted, not omitted; an opaque cursor crosses byte-for-byte; absent
  and negative `limit` both become `0`; a positive one is passed through unclamped; a non-finite one
  becomes `0`; the payload is exactly three keys when the input carries an extra property.
- `inboundMessage.test.ts` — a populated page decodes; the terminal page (`entries: []`, `cursor: ''`,
  `at_start: true`) decodes rather than failing on the empty cursor; an entry with an unrecognised
  `type` is carried through; the entry `payload` crosses verbatim including nested objects; six
  malformed shapes each throw; `inReplyTo` propagates and is `undefined` when omitted; the log record
  is content-free (contains the hash, contains neither a cursor nor an entry payload value); each of
  the five codes narrows and an unknown one yields `undefined`; the eleven existing `daemon-error`
  assertions stay green.
- `daemonConnection.test.ts` — the built frame reaches the wire; a page correlated by `in_reply_to`
  emits `historyPageReceived` carrying the **requested** conversation id and no wire routing id; a
  page with an absent or unmatched `in_reply_to` emits nothing; a correlated `error` emits
  `historyRequestFailed` with the right reason, with `retryable` true only for `history.unavailable`
  and false for the other five including `'unclassified'`; a second page under the same envelope id
  is dropped (the entry was deleted); `dial()` clears the map; a correlated error does not fail a
  healthy in-flight bundle.
- `commands.test.ts` — the guard accepts a well-formed payload and rejects each missing/mistyped
  field; `''` cursor and `''` conversation id pass.

Fakes over mocks throughout: `fakeDaemon` / the existing driver fake drive the frames, exactly as the
`session_settings` tests do.

## Open questions

1. **Does `message.too_long` actually reach a `request_history`'s `in_reply_to`?** The protocol says
   the daemon emits an unfittable entry anyway and "its own transport answers `message.too_long`".
   Whether that error is correlated to the request or emitted uncorrelated is not stated. The design
   is correct either way — an uncorrelated one falls through to the existing consumers unchanged, a
   correlated one settles the ask as `'unclassified'` — so this is a documentation gap, not a
   blocker. Resolve by reading the daemon's handler if it becomes cheap; otherwise leave the
   catch-all as the fail-safe.
2. **Should an outstanding ask have a deadline?** Deferred to #1224 as stated above. Record the
   resolution here if implementation shows the walk cannot be written without one.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.** The design has one explicit untrusted→trusted boundary per
  direction and both are named types. Inbound: `parseHistoryPagePayload` / `parseHistoryEntry` /
  `narrowHistoryRejectReason` in `inboundMessage.ts` — `payload: unknown` never escapes them, and
  everything downstream holds `HistoryPagePayload` / `HistoryRejectReason`. Outbound: the
  renderer is untrusted relative to main, and `isRequestHistoryPayload` in `commands.ts` is the gate
  every `requestHistory` command passes, with `buildRequestHistory`'s fresh three-key literal as the
  second bound that keeps a smuggled field off the wire. The one field that is *not* boundary-derived
  is `conversationId` on both new events, and its provenance is stated on the arms: client-owned,
  never parsed from an inbound payload.
- **[Trust boundaries] SHOULD FIX — an entry's `payload` is trusted in shape and untrusted in
  content, and the type system carries no signal for that.** A decoded `HistoryEntry` looks settled
  but its `type` and `payload` are **replayed content**, operator- or `claude`-authored, carrying
  exactly the trust class of the live frame they mirror — the daemon's § *Security model* threat 1
  lands here. Nothing about being stored makes them more trusted. Phase B states this on
  `HistoryEntry`'s docblock in the same voice `RetrievedAttachmentChunk` uses, so #1223 cannot read
  the type as pre-sanitised. Not a MUST FIX because nothing in this slice renders, resolves or
  dispatches on either field.
- **[Trust boundaries] SHOULD FIX — `payload` crosses by reference and a `__proto__` key survives in
  it.** `JSON.parse` makes `__proto__` an ordinary own data property, so it is inert here: this slice
  never assigns through it, never uses it as a lookup path, and object spread (`CreateDataProperty`)
  would not trigger the setter either. The reachable hazard is `Object.assign(target, entry.payload)`
  or a `target[k] = v` copy loop in a **later** consumer. Phase B records that rule on the field's
  docblock. Deep-copying or key-stripping here is rejected: the payload is arbitrary nested JSON, a
  recursive scrub would be unbounded work on a hostile frame, and `RESERVED_MAP_KEYS`' precedent is
  scoped to a flat map whose keys the daemon chooses.
- **[Tokens, secrets, credentials] No findings, and one active decision.** The cursor is the only
  new opaque token, and the daemon publishes that it is **deliberately unsigned, not a secret and not
  a capability** — authorization is pairing, enforced at the Noise handshake. It is therefore stored
  and echoed verbatim and never treated as proving anything: no comparison, no validation, no
  derivation, and specifically no `timingSafeEqual`, which would imply a secret it is not. It reaches
  no disk and no `safeStorage`; it lives in a renderer-held string and a main-process frame build for
  the life of one walk. No new credential, no rotation or revocation surface.
- **[File / storage operations] N/A by construction.** This slice performs no filesystem operation.
  The design decision that makes it N/A rather than merely absent: the `conversation_id` and the
  `cursor` are never joined into a path, a filename or a cache key on this side — the daemon's own
  § *Rejects* records that an empty conversation id joined into a path resolves to the log **root**,
  and the mirror-image rule binds here. Both are object values in payloads that get rebuilt from
  scratch.
- **[Inter-process / Electron attack surface] No findings.** No new `BrowserWindow`, no
  `webPreferences` change, no custom protocol, no navigation handler. The IPC surface grows by
  exactly one command member on the existing `RendererCommand` channel, validated by
  `isRequestHistoryPayload` before use, and by two `DaemonEvent` arms on the existing event channel.
  Neither arm can hold a token, key or raw frame: `entries` holds decoded wire types, `cursor` and
  `conversationId` are strings, `reason` is a client-owned literal. Process placement is unchanged —
  the frame build, the codec, the correlation map and every parser stay in main; the window receives
  already-typed events and never sees `in_reply_to`, a socket or a byte.
- **[Cryptographic primitives] N/A.** No randomness, no hashing, no key material, no comparison
  against a secret. The correlation key is `nextEnvelopeId`, a monotonic counter shared with every
  other verb — deliberately not random, because it is a routing id rather than an unguessable
  capability, and its confidentiality is provided by the Noise session it rides inside.
- **[Network & I/O] No findings.** No new socket, no new URL, no new timeout knob — the frame rides
  the existing Noise session on the existing relay connection, and `MAX_PLAINTEXT_BYTES` bounds an
  inbound page before any parse. The memory-exhaustion question a paged verb raises is answered
  upstream and checked: nothing is allocated from a daemon-supplied count (the `entries` array is
  built by `.map` over an already-materialised array, never `new Array(claimedCount)`), and the
  daemon re-asks a too-large page at a smaller size rather than delivering one over the cap.
- **[Error messages, logs, telemetry] No findings.** The decode logs the existing content-free record
  only — static `code: 'history_page'`, byte length, one-way hash — and narrows before logging, so a
  malformed page throws first and leaves no record. No cursor, entry payload, entry `type`, entry
  `id` or reject string reaches a log line; the daemon's reject messages are static and echo nothing
  from the request, and nothing here undoes that by logging what was sent. `WireDecodeError` messages
  name the client-owned field constant only. `requestHistory`'s catch drops its caught object
  (classify-don't-forward), and `emitDaemonEvent` is log-free by construction.
- **[Concurrency] No findings.** One new synchronous map with a single writer, no `await` between any
  read and write, drained on match and cleared on `dial()`. No new async task, timer, listener or
  subscription, so there is nothing to cancel and no listener to leak. The one ordering rule that
  matters is enforced and tested: the map entry is written **after** a successful send, so a build or
  send that throws advances no envelope id and leaves no entry to be answered by whichever request
  re-mints it.
- **[Threat model alignment] Malicious relay — addressed.** It is on-path and content-blind: it can
  drop, delay, reorder or flood. A dropped page produces an unanswered ask that is abandoned at the
  next `dial()`; nothing retries, so a withholding relay cannot induce a spin. A replayed or
  reordered page is dropped by the correlation gate once its entry is deleted. No plaintext leaves
  the Noise session.
- **[Threat model alignment] Hostile daemon — addressed, and it is the primary threat here.** Every
  field of an inbound page is remote-authored. A forged page for an ask this client never sent is
  dropped by the correlation gate rather than attributed to the open conversation; a mangled one
  fails closed with no partial value; a forged reject can at worst settle one outstanding ask with a
  client-owned reason literal. The one thing a hostile daemon **can** do that this slice does not
  prevent is serve a page whose entries belong to a different conversation than the one asked about —
  and that is unpreventable client-side by construction, because the page names no conversation. It
  is the same exposure `session_settings` already carries, bounded by the same thing: authorization
  is pairing, so the peer able to do it is one the operator already paired with.
- **[Threat model alignment] Renderer compromise reaching the transport — addressed.** A compromised
  renderer gains exactly one new capability: asking for any conversation's history by id. It cannot
  reach another *server's* — the command is conversation-routed through `conversationRouter`, a
  read-only lookup against an index built from the daemon's own conversation lists, so an id no
  server has claimed puts no frame on any wire. It gains no path, no key and no socket.
- **[Threat model alignment] OUT OF SCOPE — reduction, dedupe and render of replayed content.**
  Escaping and length-bounding an entry's text, joining a page to the live stream on (`type`, `ts`),
  and the walk's retry policy are #1223, #1225 and #1224 respectively. Each inherits the
  replayed-content warning this plan puts on `HistoryEntry`.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07
