# Request history send (conversation scroll-back, transport leg)

The **transport-only** half of conversation scroll-back: an outbound `request_history` ask, a decoded
`history_page` reply, and the five published refusals reaching the window as a typed, correlated
failure. A conversation opened today shows nothing that happened before this client connected — this
slice teaches the desktop transport to ask the daemon's append-only on-disk log
(pyrycode#2112/#2113/#2116) for one backward step of a walk over it, and stops there.

Introduced in [#1222](../codebase/1222.md), split from #1088. **Nothing asks for a page** (that's
[#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224)), **nothing renders one** (that's
[#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)), and **nothing joins a page to the
live stream** (that's [#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225)). All four
exhaustive bridges take permanent-for-now null arms; this ticket ships the ability to ask and the
ability to decode the answer, nothing more.

Nearest shapes in the tree: `ddd9a0b` ([session settings send](session-settings-send.md), request +
reply decode) is the full request-and-decode analogue; `e199833` (#1165, `requestModelList`) is the
request half alone. This ticket copies both rather than inventing a new arrangement, and diverges from
each in exactly the two places the design review below names.

## The one fact that shapes every piece

**A `history_page` carries no `conversation_id`.** Which conversation a page describes is knowable only
from which envelope it answers, so the requester keeps its outstanding asks keyed by envelope id, and
the `conversationId` that crosses to the window is **client-owned** — the id this app put in its own
outbound frame, never a string parsed off the network. This is exactly `pendingConfigRequests`'
argument for `session_settings` ([daemon connection — correlation](daemon-connection-correlation.md)),
reused here rather than re-derived.

## Where it lives

| Piece | File | Role |
|---|---|---|
| `RequestHistoryPayload` / `HistoryEntry` / `HistoryPagePayload` + `'request_history'`/`'history_page'` `EnvelopeType` members | `src/shared/wire/types.ts` | ported wire types, field-for-field with the daemon |
| `buildRequestHistory` | `src/main/transport/requestHistoryEnvelope.ts` (new) | pure outbound builder |
| `requireRecord`, `parseHistoryEntry`, `parseHistoryPagePayload`, `HistoryRejectReason`, `narrowHistoryRejectReason` | `src/main/transport/inboundMessage.ts` | fail-closed inbound decode + the reject narrower |
| `requestHistory(payload)`, `pendingHistoryRequests` | `src/main/daemonConnection.ts` | connection method + envelope-id → conversation correlation |
| `requestHistory` command / `isRequestHistoryPayload` guard | `src/shared/ipc/commands.ts` | the sealed union member + untrusted-boundary guard |
| `case 'requestHistory'` | `src/main/index.ts` | conversation-routed dispatch |
| `requestHistory` delegate | `src/main/connectionRegistry.ts` | the stand-in's one added line |
| `HistoryRequestFailure`, `historyPageReceived` / `historyRequestFailed` | `src/shared/ipc/events.ts` | the two `DaemonEvent` arms |
| null arms | `timelineBridge.ts` / `daemonEventBridge.ts` / `modalBridge.ts` / `questionBridge.ts` | the four exhaustive bridges, dormant |

## The wire types (`src/shared/wire/types.ts`)

```ts
export interface RequestHistoryPayload {
  conversation_id: string
  cursor: string
  limit: number
}

export interface HistoryEntry {
  id: number
  type: string
  payload: Record<string, unknown>
  ts: string
}

export interface HistoryPagePayload {
  entries: HistoryEntry[]
  cursor: string
  at_start: boolean
}
```

`'request_history'` and `'history_page'` join `EnvelopeType`, each comment naming § *Conversation
history (v2)* of the daemon's `docs/protocol-mobile.md`.

- **All three `RequestHistoryPayload` keys are always on the wire** — the daemon declares no
  `omitempty` — so a decoder on either side may rely on all three, and this client emits all three
  unconditionally.
- **The cursor is opaque on both sides and must never be parsed.** It names a position in an
  append-only file rather than an offset a concurrent append would invalidate. Empty means "start at
  the newest" — the normal opening value of a walk, not a missing one — and the reply's own cursor is
  empty whenever `at_start` is true. It is deliberately **unsigned**: not a secret and not a
  capability, since authorization is pairing at the Noise handshake, not anything the cursor proves.
- **`limit: 0` (sent as zero, or omitted) asks the daemon to choose**, never zero entries. A negative
  limit is a reject; an ask above the daemon's `history.MaxPageEntries` ceiling (4096) is clamped, not
  refused — so this client invents no ceiling of its own.
- **`HistoryEntry.id` is the durable on-disk log id and is *not* an `event_id`.** The latter is the
  in-memory replay ring's, per-process and reset by a restart; the two look like small integers and
  must never be joined.
- **`HistoryEntry.type` is a stored string nothing re-validates.** It spans the whole live-lane
  vocabulary (every interactive-stream frame, `session_transition`, the operator's own `message`), so
  it is deliberately *not* narrowed to `EnvelopeType` or any closed set — an unrecognised value decodes
  and is carried through, never rejected.
- **`HistoryEntry.payload` is replayed content, not more trusted for having been stored.** It is typed
  `Record<string, unknown>` rather than a union of known wire payloads (it can hold a `type` this
  client doesn't recognise), crosses **verbatim**, and is interpreted nowhere in this ticket — #1223
  owns the reduction. `MessagePayload` (already in `types.ts`) is named in the comment so no one mints
  a duplicate; nothing here narrows an entry into it. It carries the daemon's § *Security model* threat
  1 exactly as the live frame it mirrors does.
- **`HistoryPagePayload` carries no `conversation_id` — a decision, not an omission.** See § The one
  fact above.
- **`at_start` is the only termination signal.** A page filling exactly at the log's first entry
  reports `at_start: false` with a usable cursor, and a page may come back shorter than asked because
  the daemon budgets bytes rather than entries alone — so a short or empty page is never normalised
  into an end-of-log flag anywhere on this path.

## Outbound — `src/main/transport/requestHistoryEnvelope.ts` (new, main-only)

```ts
export interface RequestHistoryInput {
  id: number
  ts: string
  conversationId: string
  cursor: string
  limit?: number
}
export function buildRequestHistory(input: RequestHistoryInput): Uint8Array
```

A sibling to `requestModelListEnvelope.ts` — same one-concern-per-file split, same **fresh three-key
literal, never a spread of the caller's object**, so a field smuggled past the command guard is dropped
here rather than sent.

- `conversationId`/`cursor` are **required** and cross unchecked for emptiness: an empty conversation
  id draws the daemon's `conversation.not_found`, and `''` is the cursor's normal opening value — the
  daemon's call to make, not a policy this builder pre-empts.
- `limit` is the one **optional** input, normalised to `0` when absent or not a finite number greater
  than zero. The `Number.isFinite` check exists because `JSON.stringify` writes `NaN`/`Infinity` as
  `null`, which would break the "always a number" wire contract. Non-integers are deliberately **not**
  floored — every call site supplies an integer, and a malformed one draws the daemon's
  `history.invalid_request`, which this slice now surfaces as a typed failure rather than silently
  repairing.
- **MAY throw** `WireEncodeError`: unlike its fixed-shape neighbours, this frame carries a
  daemon-minted cursor of unpublished length, so an over-cap ask is conceivable rather than merely
  theoretical. The sole caller (`daemonConnection.requestHistory`) catches it.

## The command + guard (`src/shared/ipc/commands.ts`)

```ts
| { type: 'requestHistory'; payload: RequestHistoryPayload }

function isRequestHistoryPayload(value: unknown): value is RequestHistoryPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value && typeof value.conversation_id === 'string' &&
    'cursor' in value && typeof value.cursor === 'string' &&
    'limit' in value && typeof value.limit === 'number'
  )
}
```

Types, not emptiness, matching the builder's own posture — `''` is a valid cursor and a
valid-if-unresolvable conversation id; the daemon polices ids. Structural minimum: an extra field
passes the guard and cannot reach the wire, because the builder's fresh literal bounds the frame
regardless. `src/main/index.ts`'s `case 'requestHistory':` is conversation-routed exactly like
`requestModelList`, reading `command.payload.conversation_id` once as both the routing key and the
field the builder consumes, so the id routed by and the id sent can never be two different
expressions. `connectionRegistry.ts`'s `viewOf` gained one delegate line.

## Inbound decode (`src/main/transport/inboundMessage.ts`)

New `InboundDaemonMessage` member: `{ kind: 'history-page'; historyPage: HistoryPagePayload; inReplyTo?:
number }` — `inReplyTo` **optional**, like `session-settings`'s and unlike `attachment-chunk`'s
required one, because a page without a correlation handle is merely uncorrelatable (the fail-closed
drop belongs one layer up in `daemonConnection`), not malformed the way an unsolicited retrieval chunk
would be.

- **`requireRecord(payload, field)`** — a new one-field helper narrowing an opaque nested object,
  needed because no existing helper fits: `optionalStringMap` requires string *values*, and an entry's
  `payload` is arbitrary nested JSON. Returns the **same object**, not a fresh one — a flat map is
  cheap to rebuild but arbitrary nesting is unbounded work on a hostile frame, so this validates shape
  and carries the reference. Nothing is stripped (no `RESERVED_MAP_KEYS` pass): a `__proto__` key off
  `JSON.parse` is an ordinary own data property, inert to read/spread/`structuredClone`; the reachable
  hazard (`Object.assign(target, payload)` or a `target[k] = v` copy loop in a *later* consumer) is
  recorded on `HistoryEntry`'s own docblock instead.
- **`parseHistoryEntry(raw)`** — `isRecord` guard, then `requireNumber('id')`, `requireString('type')`,
  `requireRecord('payload')`, `requireString('ts')`. Returns a fresh four-key literal so no extra
  property (an `event_id`, a `conversation_id` the daemon never promised) rides along.
- **`parseHistoryPagePayload(payload)`** — `Array.isArray(entries)` then `.map(parseHistoryEntry)` (one
  bad element fails the whole page closed, `[]` is valid and never `null`, the result is a fresh
  array), `requireString('cursor')` — **not** `requireNonEmptyString`, since the cursor is empty
  whenever `at_start` is true — and `requireBoolean('at_start')` (type-checked, never truthiness-checked,
  since `false` is what every mid-walk page carries).
- **No count bound and no size bound**, the `parseBackgroundTaskRosterPayload` posture. The
  frame-level `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails an
  oversized frame before any parse runs, and the daemon clamps the entry count at construction and
  re-asks a too-large page at a smaller size rather than truncating one — so a client-side bound below
  4096 would drop valid pages, and one above it would defend a failure that cannot reach this code.
  Nothing is allocated from a daemon-supplied count either: the array is built by mapping an
  already-materialised one, never `new Array(claimed)`.
- The `case 'history_page':` switch arm narrows **before** logging, then emits the existing
  content-free record (`event: 'inbound-decoded'`, `code: 'history_page'`, byte length, one-way hash).
  No cursor, entry payload, entry `type`, entry `id`, or reject string reaches a log line anywhere on
  this path.

### The reject path — a second narrower, not a widened `DaemonErrorOutcome`

**This is the slice's one non-obvious design call.** [Daemon error outcome](daemon-error-outcome.md)'s
`narrowDaemonErrorOutcome`/`DaemonErrorOutcome` is the closed-enum comparand idiom AC4 points at — but
that type is not a free-standing vocabulary. `AttachmentTransferFailure` inherits it **whole**,
`AttachmentUploadFailure` mirrors that mechanically across IPC, and a renderer copy table is keyed on
the mirror. Adding `history.invalid_cursor` there would land it in the attachment-upload failure union
and demand composer copy for a failure no upload can produce — wrong, and outside this ticket's scope.

So the history codes get their own narrower beside it, mirroring every property that matters and
diverging in one:

```ts
export type HistoryRejectReason =
  | 'conversation-not-found'
  | 'history-invalid-request'
  | 'history-invalid-page-size'
  | 'history-invalid-cursor'
  | 'history-unavailable'

function narrowHistoryRejectReason(payload: unknown): HistoryRejectReason | undefined
```

- **Total by construction, never throws** — an `error` frame is terminal because it *arrived*, not
  because its payload parsed, and the four existing `daemon-error` consumers must still fire on every
  one.
- **The `switch` *is* the trust boundary**, comparing the untrusted `code` string against client-owned
  constants and returning a client-owned constant; the daemon's string is never an index, a join, a
  resolve, or a retained value.
- **Diverges from its neighbour in exactly one way**: it returns `undefined` outside its five-member
  set rather than an `'unclassified'` member of its own — because "is this *one verb's* refusal, and
  which" is a narrower question than `DaemonErrorOutcome`'s "what class of failure is this over *every*
  frame." § *Page size* publishes the case that makes this reachable rather than theoretical: when one
  stored entry is too large for any page, the daemon emits it anyway and its own transport answers
  `message.too_long` — a code `narrowDaemonErrorOutcome` *does* classify, but this narrower does not.

The `daemon-error` kind grows one **optional** field, `historyReject?: HistoryRejectReason` —
optional where `outcome` is required, deliberately: `outcome`'s requiredness exists so no consumer has
a field-missing state to mishandle across four correlations, while here absence has exactly one
meaning ("this code is outside the published history set") read at exactly one emit, which maps it to
the IPC event's `'unclassified'` member. Keeping it optional also avoids reddening the eleven existing
`daemon-error` assertions for no behavioural gain.

## Correlation (`src/main/daemonConnection.ts`)

A fifth correlation store, `pendingHistoryRequests: Map<number, string>` — envelope id → the
conversation id the request named — sited beside `pendingConfigRequests` and following its every rule.
See [Daemon connection — correlation § Conversation-history correlation
(#1222)](daemon-connection-correlation.md#conversation-history-correlation-1222) for the full
walk-through; in outline:

- **Set only after a successful send.** `requestHistory(payload)` captures `envelopeId =
  nextEnvelopeId` into one local read three times (build, counter advance, map set), advances the
  counter only after a successful `buildRequestHistory`, calls `driver.sendMessage`, and only then
  records `pendingHistoryRequests.set(envelopeId, payload.conversation_id)`. A build or send that
  throws leaves no entry under an unspent id — an entry left there would answer whichever request
  next re-mints that id, with the wrong conversation's transcript.
- **Match + delete, fail-closed.** `case 'history-page':` short-circuits before the lookup when
  `inReplyTo` is absent, short-circuits again on a map miss (a stale reply, a duplicate of an
  already-matched page, or a hostile daemon forging a page for an ask never sent), and on a hit
  `delete`s the entry and emits `historyPageReceived` as a **fresh named-field literal** — never a
  spread of the decoded payload.
- **`case 'daemon-error':` gains a fourth precedence-tier member**, checked alongside
  `pendingSettings`/`pendingCreateFolders`/`pendingRetrievals`. A hit deletes the entry, emits
  `historyRequestFailed` with `reason = inbound.historyReject ?? 'unclassified'` and `retryable =
  reason === 'history-unavailable'`, and returns before the reassembler/modal-FIFO fallbacks. Order
  among the tier's members is immaterial — an envelope id is minted once, so at most one store can
  hold it.
- **Reset on `dial()`**, beside its four siblings — a fresh connection recycles envelope ids from 2, so
  a surviving entry would attribute the new connection's first page to a dead one's conversation.
- **No cap**, the same evidence-based, no-observed-failure posture every sibling store in this file
  takes; an entry costs one number and one string, and the only way to accumulate them is this client
  sending asks a daemon never answers.

## The `DaemonEvent` arms (`src/shared/ipc/events.ts`)

```ts
export type HistoryRequestFailure =
  | 'conversation-not-found' | 'history-invalid-request' | 'history-invalid-page-size'
  | 'history-invalid-cursor' | 'history-unavailable' | 'unclassified'

| { type: 'historyPageReceived'; conversationId: string
    entries: readonly HistoryEntry[]; cursor: string; atStart: boolean }
| { type: 'historyRequestFailed'; conversationId: string
    reason: HistoryRequestFailure; retryable: boolean }
```

- **`HistoryRequestFailure` duplicates `HistoryRejectReason`'s members by hand** rather than importing
  them — `inboundMessage.ts` is IPC-free by placement rule, so the narrowed type cannot cross the
  boundary it exists to define. `AttachmentUploadFailure` already mirrors `DaemonErrorOutcome` the same
  way, for the same reason.
- **The sixth member, `'unclassified'`, is not a hedge.** It is where a correlated `message.too_long`
  lands — the § *Page size* case above — so a correlated refusal always settles the outstanding ask
  rather than stalling a walk with no terminal.
- **`retryable` is computed once, at the emit**, diverging deliberately from `DaemonErrorOutcome`'s
  documented-not-computed posture: that type's retry flags live in two upstream files, so no single
  client-side list could be right, where this verb's five codes are published in one section with
  exactly one retryable member (`history.unavailable`). The consumer that would otherwise re-derive it
  is the walk driver (#1224) — precisely where a wrong re-derivation becomes a self-inflicted retry
  loop against a relay merely withholding the frame.
- **`conversationId` on both arms is client-owned**, carrying `runConfigReceived`'s provenance
  argument verbatim — see § The one fact above. It is a routing key, never rendered text, and reaches
  no log sink. The numeric `in_reply_to` it was resolved from is **not** carried.
- **`entries` is the most untrusted payload on this union.** Each entry mirrors the daemon's §
  *Security model* threat 1 exactly as the live frame it replays does; nothing about being stored makes
  it more trusted, and the eventual render surface owes it the same sanitisation the live lane already
  gets.

The four exhaustive bridges (`timelineBridge`, `daemonEventBridge`, `modalBridge`, `questionBridge`)
each gain two null arms — the compile-time guard doing its job. `daemonEventBridge`'s disposition is
**permanent** (a replayed frame is never a `SessionAction`); `modalBridge`'s is **permanent** for the
same reason a page may *carry* a stored `modal_shown` without *being* one; `questionBridge`'s is
permanent on the same "not a question event" grounds. `timelineBridge`'s two arms are **dormant, not
permanent** — a page's entries are literally timeline items (that's the whole point of an entry
carrying a stored frame's `type`/`payload`), and #1223 is expected to claim them.

## Data flow

```
window → sendCommand({type:'requestHistory', payload:{conversation_id, cursor, limit}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isRequestHistoryPayload)
      → router.route(conversation_id)?.requestHistory(payload)
      → buildRequestHistory (fresh 3-key literal) → driver.sendMessage
        → pendingHistoryRequests.set(envelopeId, conversation_id)   [only after a successful send]

daemon → history_page frame → parseHistoryPagePayload (fail-closed) → { kind:'history-page', historyPage, inReplyTo }
      → daemonConnection matches inReplyTo against pendingHistoryRequests
      → hit:  delete entry → DaemonEvent{ historyPageReceived, conversationId, entries, cursor, atStart }
      → miss / absent inReplyTo: dropped silently, no event

daemon → error frame (in_reply_to matches a pending history ask)
      → daemon-error tier's fourth member: delete entry → DaemonEvent{ historyRequestFailed, conversationId,
        reason: inbound.historyReject ?? 'unclassified', retryable }
      → non-matching / absent inReplyTo: falls through unchanged to the pre-existing daemon-error consumers

→ DAEMON_EVENT_CHANNEL → all four exhaustive bridges: null (timelineBridge dormant, the other three permanent)
```

## Error handling

| Layer | Result | Failure behaviour |
|---|---|---|
| `buildRequestHistory` | `Uint8Array` | May throw `WireEncodeError` (unpublished cursor length); the sole caller catches and drops — an over-cap ask fails closed as a dropped send. |
| `isRequestHistoryPayload` | `boolean` | A missing/mistyped field is rejected at the untrusted→trusted boundary; the command is dropped before reaching main logic. |
| `parseHistoryPagePayload` / `parseHistoryEntry` | `HistoryPagePayload` | Throws `WireDecodeError` on any malformed shape — non-array `entries`, one bad element, a missing/mistyped field, a non-object entry `payload`. Never a partial page. |
| `parseInboundMessage` | frame-level | An oversized frame throws before any parse (`MAX_PLAINTEXT_BYTES`); the consumer's existing `catch` drops it with no event, no log. |
| `narrowHistoryRejectReason` | `HistoryRejectReason \| undefined` | Total; never throws. A non-record payload, an absent `code`, a non-string `code`, or an unrecognised one all yield `undefined` → `'unclassified'` at the IPC emit. |
| `requestHistory` (connection method) | `void` | Inert no-op when `driver === null`. `try/catch` drops any thrown object silently — never logged, never forwarded, no retry. |
| `case 'history-page'` (consumer) | `void` | Absent or unmatched `inReplyTo` → dropped silently. A hit → exactly one `historyPageReceived`. |
| `case 'daemon-error'` (consumer, history tier) | `void` | A correlated refusal always settles the ask, including a code outside the five (`'unclassified'`). A miss falls through unchanged to the pre-existing `daemon-error` consumers. |
| Window | — | Nothing yet: both arms are dormant/permanent-null across all four bridges. #1223/#1224 are the first consumers. |

## Security properties

Ticket carries `security-sensitive`; builder self-review verdict **PASS**, no MUST FIX findings (two
SHOULD FIX, both documentation-only — see below).

- **One boundary per direction, both named types.** Inbound: `parseHistoryPagePayload` /
  `parseHistoryEntry` / `narrowHistoryRejectReason` in `inboundMessage.ts` — `payload: unknown` never
  escapes them. Outbound: `isRequestHistoryPayload` in `commands.ts` gates every `requestHistory`
  command, and `buildRequestHistory`'s fresh three-key literal is the second bound that keeps a
  smuggled field off the wire regardless of what the guard admitted.
- **`conversationId` on both new events is client-owned, not boundary-derived** — sourced from this
  app's own outbound frame, held in main-process memory, and handed back; never parsed from an inbound
  payload. Naming a conversation is not authorization; the daemon validates it against its own
  registry and authorization is pairing at the Noise handshake.
- **An entry's `payload` is trusted in shape and untrusted in content (SHOULD FIX, documentation-only).**
  A decoded `HistoryEntry` looks settled but its `type` and `payload` are replayed content — the
  daemon's § *Security model* threat 1 lands here exactly as it does on the live frame each entry
  mirrors. `HistoryEntry`'s docblock states this in the same voice `RetrievedAttachmentChunk` uses, so
  #1223 cannot read the type as pre-sanitised. Not a MUST FIX because nothing in this slice renders,
  resolves, or dispatches on either field.
- **`payload` crosses by reference and a `__proto__` key survives in it (SHOULD FIX,
  documentation-only).** `JSON.parse` makes `__proto__` an ordinary own data property — inert to read,
  spread, and `structuredClone`. The reachable hazard is `Object.assign(target, entry.payload)` or a
  `target[k] = v` copy loop in a **later** consumer; `HistoryEntry`'s docblock records the rule.
  Deep-copying or key-stripping here was rejected: the payload is arbitrary nested JSON, a recursive
  scrub would be unbounded work on a hostile frame, and `RESERVED_MAP_KEYS`'s precedent is scoped to a
  flat map whose keys the daemon chooses.
- **The cursor is deliberately unsigned, not a secret, and not a capability.** It is stored and echoed
  verbatim, never compared, validated, derived, or checked with `timingSafeEqual` (which would imply a
  secret it is not). It reaches no disk and no `safeStorage`.
- **No filesystem operation on this slice.** `conversation_id` and `cursor` are never joined into a
  path, filename, or cache key — the daemon's own rule that an empty conversation id joined into a path
  resolves to the log root is a mirror-image concern that binds here structurally, not by a runtime
  check.
- **No new `BrowserWindow`, no `webPreferences` change.** The IPC surface grows by exactly one command
  member (validated by `isRequestHistoryPayload`) and two `DaemonEvent` arms — neither can hold a
  token, key, or raw frame.
- **No client-invented size or count bound**, and this is checked rather than assumed: `entries` is
  built by `.map` over an already-materialised array, never `new Array(claimedCount)`, so nothing is
  allocated from a daemon-supplied count.
- **Content-free logging preserved.** The decode logs the existing static record only — no cursor,
  entry payload, entry `type`, entry `id`, or reject string reaches a log line. `requestHistory`'s
  catch drops its caught object (classify-don't-forward).
- **Threat model: malicious relay** — addressed. It is on-path and content-blind; a dropped page
  produces an unanswered ask abandoned at the next `dial()`, and nothing retries, so a withholding
  relay cannot induce a spin.
- **Threat model: hostile daemon** — the primary threat here, addressed. A forged page for an ask never
  sent is dropped by the correlation gate rather than attributed to the open conversation; a mangled
  one fails closed with no partial value; a forged reject settles at worst one outstanding ask with a
  client-owned reason literal. The one thing a hostile daemon *can* do that this slice cannot prevent
  — serve a page whose entries belong to a different conversation than the one asked about — is
  unpreventable client-side by construction (the page names no conversation), and is bounded the same
  way `session_settings` already is: the peer able to do it is one the operator already paired with.
- **Threat model: renderer compromise** — addressed. A compromised renderer gains exactly one new
  capability, asking for any conversation's history by id; it cannot reach another server's, since the
  command is conversation-routed through a read-only index built from the daemon's own conversation
  lists.

## Testing strategy

All vitest; no Playwright spec, since nothing in the window reaches this path in this slice.

- `requestHistoryEnvelope.test.ts` (new) — real codec bytes decoded back: all three keys always
  present; an empty cursor is emitted, not omitted; an opaque cursor crosses byte-for-byte; absent and
  negative `limit` both become `0`; a positive one passes through unclamped; a non-finite one becomes
  `0`; the payload is exactly three keys when the input carries an extra property.
- `inboundMessage.test.ts` — a populated page decodes; the terminal page (`entries: []`, `cursor: ''`,
  `at_start: true`) decodes rather than failing on the empty cursor; an entry with an unrecognised
  `type` is carried through; the entry `payload` crosses verbatim including nested objects; malformed
  shapes each throw; `inReplyTo` propagates and is `undefined` when omitted; the log record is
  content-free; each of the five codes narrows and an unknown one yields `undefined`; the pre-existing
  `daemon-error` assertions stay green.
- `daemonConnection.test.ts` — the built frame reaches the wire; a page correlated by `in_reply_to`
  emits `historyPageReceived` carrying the **requested** conversation id and no wire routing id; an
  absent or unmatched `in_reply_to` emits nothing; a correlated `error` emits `historyRequestFailed`
  with the right reason, `retryable` true only for `history-unavailable`; a second page under the same
  envelope id is dropped (the entry was deleted); `dial()` clears the map; a correlated history error
  does not fail a healthy in-flight bundle.
- `commands.test.ts` — the guard accepts a well-formed payload and rejects each missing/mistyped field;
  `''` cursor and `''` conversation id pass.

Fakes over mocks throughout: the existing driver fake drives the frames, exactly as the
`session_settings` tests do.

## Related

- [Session settings send](session-settings-send.md) / `ddd9a0b` — the full request-and-decode
  analogue this ticket copies: the `send`-twin connection method, the correlation-map shape, and the
  fail-closed `daemon-error` precedence tier.
- [Daemon connection — correlation § Conversation-history correlation
  (#1222)](daemon-connection-correlation.md#conversation-history-correlation-1222) — the
  `pendingHistoryRequests` walk-through in full.
- [Daemon connection — methods](daemon-connection-methods.md) — the `requestHistory(payload)` entry in
  the public surface.
- [Daemon-event channel — the sealed union](daemon-event-channel-sealed-union.md) — where
  `historyPageReceived`/`historyRequestFailed` would be catalogued alongside every other arm, once a
  render consumer exists to warrant the entry.
- [Inbound message decode — extension history](inbound-message-decode-history.md) — the `history_page`
  kind's place in the chronological account of every additive extension to `InboundDaemonMessage`.
- [Daemon error outcome](daemon-error-outcome.md) — the sibling narrower `HistoryRejectReason` mirrors
  and deliberately does not extend; see § The reject path above for why.
- [Command channel](command-channel.md) — the `requestHistory` `RendererCommand` member +
  `isRequestHistoryPayload` guard this channel's union gained.
- `docs/specs/architecture/1222-request-history-decode.md` — the full architecture spec, including the
  open questions (whether a correlated `message.too_long` is observed in practice; whether an
  outstanding ask needs a deadline, deferred to #1224) and the full security review this doc
  summarizes.
