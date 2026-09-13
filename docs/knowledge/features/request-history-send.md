# Request history send (conversation scroll-back, transport leg)

The **transport-only** half of conversation scroll-back: an outbound `request_history` ask, a decoded
`history_page` reply, and the five published refusals reaching the window as a typed, correlated
failure. The daemon's append-only log supplies one page per request. The renderer's
[history bridge](conversation-timeline-store.md) draws decoded pages independently
of the live bridges, keeping the existing [history/live join](conversation-timeline-store-internals.md#the-historylive-join-1225).

Introduced in [#1222](../codebase/1222.md), with payload decoding in #1227 and
rendering in #1223. The former opening ask and scroll-event walk are now replaced
by [user-demand paging](chat-history.md#received-state-admission-and-ownership):
`requestOlderHistory` sends the same payload for first and subsequent pages only
on qualifying upward input. Opening and reconnect send no history requests.
Successful coverage survives interruption; neither a failure's `retryable` flag
nor page arrival starts an automatic retry.

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
| `HistoryRequestFailure`, `HistoryTimelineEvent`, `HistoryTimelineEntry`, `historyPageReceived` / `historyRequestFailed` | `src/shared/ipc/events.ts` | the two `DaemonEvent` arms; the mirrored decoded-entry types (#1227) |
| `DecodedHistoryEvent`, `DecodedHistoryEntry`, `DecodedHistoryPage`, `decodeHistoryEvent`, `decodeHistoryPage` | `src/main/transport/inboundMessage.ts` | the payload-decode stage (#1227) — see § Payload decode |
| null arms | `timelineBridge.ts` / `daemonEventBridge.ts` / `modalBridge.ts` / `questionBridge.ts` | the four exhaustive bridges; `timelineBridge`'s dormant, the rest permanent |

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
  client doesn't recognise), and it stays this shape at the wire boundary — this is the pre-decode
  type, unchanged since #1222. [#1227](https://github.com/pyrycode/pyrycode-desktop/issues/1227) added
  the stage that actually reads it (§ Payload decode below); before that, nothing did. It carries the
  daemon's § *Security model* threat 1 exactly as the live frame it mirrors does.
- **`HistoryEntry.type` was `send_message` in the SSOT prose and is `message` in the daemon — fixed by
  #1227.** `docs/protocol-mobile.md` § *A history entry* and its worked example both say
  `send_message`, but the daemon's third history producer (`operator_message_history.go`,
  pyrycode#2115) appends `protocol.TypeMessage` — `"message"` — carrying a `MessagePayload`. The
  decoder matches on `message`, matching the daemon rather than the stale doc; `HistoryEntry`'s
  docblock states this explicitly now so a future reader doesn't "fix" the decoder to match the SSOT.
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

## Payload decode (`src/main/transport/inboundMessage.ts`, #1227)

`parseHistoryPagePayload` above narrows the **envelope** of each entry (`id`/`type`/`payload`/`ts`) and
still fails the **whole page** closed on a malformed one — unchanged since #1222. What #1222 left an
entry's `payload` as was still `Record<string, unknown>`, opaque, crossing IPC verbatim. #1227 adds a
second stage, run immediately after, that reads it: `decodeHistoryPage(page: HistoryPagePayload):
{ page: DecodedHistoryPage; skipped: number }`, called from `parseInboundMessage`'s `'history_page'`
case right after the existing content-free `inbound-decoded` log line (so the throwing envelope-level
narrow still runs, and is still logged, before this non-throwing stage does).

```ts
export interface DecodedHistoryEntry { id: number; ts: string; event: DecodedHistoryEvent }
export interface DecodedHistoryPage {
  entries: readonly DecodedHistoryEntry[]
  cursor: string
  at_start: boolean
}
```

`DecodedHistoryEvent` is an eleven-arm union, one per type the timeline draws — the non-null arms of
`translateTimelineEvent` (`timelineBridge.ts`) minus its client-side `connected` edge, plus the
operator's own `message`. Each arm carries the same camelCase render fields its live `DaemonEvent` twin
carries, so a consumer can run the window's existing live-lane mapping over one unchanged; the IPC side
mirrors it by hand as `HistoryTimelineEvent`/`HistoryTimelineEntry` in `events.ts` (`inboundMessage.ts`
is IPC-free by placement rule, so the transport type cannot cross the boundary it exists to define — the
same reason `HistoryRequestFailure` duplicates `HistoryRejectReason`).

- **`decodeHistoryEvent(type: string, payload: Record<string, unknown>): DecodedHistoryEvent | null`**
  — a `switch` over the eleven wire type strings, each arm calling its existing live-lane parser
  (`parseAssistantDeltaPayload`, `parseToolUsePayload`, `parseMessagePayload`, …) and building a
  **fresh named-field literal**, dropping `conversation_id` (and, on `session_transition`,
  `previous_session_id`) the same way `translateTimelineEvent` drops it on every live arm — one layer
  earlier. `default: return null`.
- **It MUST be a `switch`, never an object-literal dispatch table** — this is the ticket's one MUST FIX
  security finding, fixed before ship. `type` is a stored, daemon-authored string nothing re-validates,
  so `TABLE[type]` would be a lookup path on untrusted input: `'__proto__'` resolves to
  `Object.prototype` (truthy, then invoked) and `'constructor'` is worse. The same rule binds any later
  "which types do we draw?" set in this codebase — a `Set`, never a bare object used as a map.
- **`decodeHistoryPage`'s loop wraps the call in `try { … } catch { event = null }`, binding no error.**
  A payload that fails to parse and a type outside the eleven both fall out as `null` and are skipped
  the same way; order is preserved among survivors, and a page every entry of which was skipped crosses
  as `entries: []` rather than as a failure, so #1260's walk can still step past it. Never throws.
- **`modal_shown`/`question_shown` have no arm at all — the sharpest case, closed by construction.**
  Neither type is in the switch, so neither can produce an event under any payload: nothing answerable
  reaches the window from history, whether a future daemon starts logging one or a hostile one plants
  one in a page. A replayed prompt answered "now" would be a resolution for a modal that closed hours
  ago.
- **The other `default`-covered types are all ordinary, not errors**: eight the live lane decodes but
  never draws in a thread (`background_task_started`/`_updated`/`_roster`, `model_announced`,
  `model_list`, `slash_command_list`, and — since [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)
  and \#1318 — `thinking_progress` and `rate_limited`, each armless here on purpose), and any type a
  later daemon invents.
- **No `conversation_id` crosses on any arm — the daemon-asserted value is dropped, the page's
  correlation-resolved `conversationId` stays the only routing key.** Every one of the eleven parsers
  requires `conversation_id` (it is the live-lane routing key, and that fail-closed read is what makes
  `?? ''` misattribution impossible there), but carrying it onward here would hand a consumer two ids
  that can disagree — exactly the misattribution #1222's correlation exists to remove.
- **Skip diagnostics are aggregated to one line per page, never one per entry — a security constraint,
  not a tidiness one.** #1222's own test proves ~1200 entries fit in one frame; a hostile daemon can
  send them all malformed and repeat the frame, so a per-entry line is a three-orders-of-magnitude
  log-write amplifier. `decodeHistoryPage`'s skip count is logged once, only when `> 0`:
  `{ event: 'inbound-decode-skipped', code: 'history_page_entry', count, hash }` — `hash` is the same
  page-line digest, so the two lines correlate. Never the entry's `type`, `id`, `ts`, or any payload
  field.

**The two mirrors (`DecodedHistoryEvent` / `HistoryTimelineEvent`) are held in agreement at two
points**: the `daemonConnection.ts` emit assigns the decoded array straight into the IPC-typed field, so
an arm missing on one side is a compile error there; and a type-only mutual-assignability guard in
`daemonConnection.test.ts` (typechecked — `tsconfig.node.json` includes `src/main/**/*`, test files
included) catches drift the other way, mutation-checked rather than assumed (adding a required field to
one union's `stallDetected` arm reddens `npm run typecheck` at the guard). Residual gap, stated rather
than papered over: an *optional* field added on one side alone passes both checks.

## Correlation (`src/main/daemonConnection.ts`)

A fifth correlation store, `pendingHistoryRequests: Map<number, string>` — envelope id → the
conversation id the request named — sited beside `pendingConfigRequests`. Each
connection admits at most one outstanding request per conversation, giving
host/conversation isolation across connection instances.
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
- **Clear before settling interruption.** `abandonHistoryRequests` snapshots the
  pending conversations, clears correlations, then emits `historyRequestFailed`
  (`reason: 'unclassified'`, `retryable: true`) for each. Drop, terminal/error,
  pairing rejection and explicit `dial()` all use it. Generation and correlation
  gates reject stale replies, while the renderer can retry on new user demand.
  Clearing without settlement leaves the held renderer request permanently pending.
- **Unavailable and build/send failures settle immediately.** A missing driver or
  unauthenticated connection emits the same classified failure; caught objects
  are discarded. Diagnostics use static `history-request-sent`,
  `history-page-received` and `history-request-failed` events with static codes,
  never ids, cursors, content or caught errors. No timer, queue or automatic retry
  is introduced; the map has no additional global count cap.

## The `DaemonEvent` arms (`src/shared/ipc/events.ts`)

```ts
export type HistoryRequestFailure =
  | 'conversation-not-found' | 'history-invalid-request' | 'history-invalid-page-size'
  | 'history-invalid-cursor' | 'history-unavailable' | 'unclassified'

| { type: 'historyPageReceived'; conversationId: string
    entries: readonly HistoryTimelineEntry[]; cursor: string; atStart: boolean }
| { type: 'historyRequestFailed'; conversationId: string
    reason: HistoryRequestFailure; retryable: boolean }
```

**`entries` changed shape under #1227.** #1222 shipped it as `readonly HistoryEntry[]` — a stored `type`
string beside an opaque `payload`, which the window would have had to parse itself. It is now `readonly
HistoryTimelineEntry[]` — see § Payload decode above — a closed union of scalars with the entry's `id`
and `ts` alongside. This **narrows** the arm rather than widening it: nothing untyped crosses IPC on this
path any more.

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
  is the walk driver (#1260) — precisely where a wrong re-derivation becomes a self-inflicted retry
  loop against a relay merely withholding the frame. [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259)
  records it (`recordHistoryFailure`) and reads it nowhere, keeping this single emit the only computation.
- **`conversationId` on both arms is client-owned**, carrying `runConfigReceived`'s provenance
  argument verbatim — see § The one fact above. It is a routing key, never rendered text, and reaches
  no log sink. The numeric `in_reply_to` it was resolved from is **not** carried.
- **`entries` is still the most untrusted payload on this union — decoding narrowed the shape, never the
  content.** Each `HistoryTimelineEvent` field is replayed content mirroring the daemon's § *Security
  model* threat 1 exactly as the live frame it replays does; nothing about being stored, or now decoded,
  makes it more trusted. The docblock on `HistoryTimelineEvent` names every field this binds
  (`assistantDelta.text`, `toolUse.name`/`inputSummary`/`input`'s keys and values,
  `toolResult.resultSummary`/`resultDetail`, `unrecognizedMessage.raw`/`messageType`,
  `sessionTransition.workspaceCwd`, `message.text`) and the render surface owes each the same
  sanitisation the live lane already gets — plain text only, never a markup sink, an attribute, a URL, a
  filename, a cache key or a lookup path. `workspaceCwd` is the one worth remembering twice: a
  daemon-supplied filesystem path, never resolved, joined or opened by this client.

The four exhaustive bridges (`timelineBridge`, `daemonEventBridge`, `modalBridge`, `questionBridge`)
each gain two null arms — the compile-time guard doing its job. `daemonEventBridge`'s disposition is
**permanent** (a replayed frame is never a `SessionAction`); `modalBridge`'s is **permanent** for the
same reason a page may *carry* a stored `modal_shown` among its wire entries without *being* one —
though since #1227 that's true only of the pre-decode wire page: the decode has no `modal_shown` arm at
all, so one can no longer reach `modalBridge`'s switch in the first place; `questionBridge`'s is
permanent on the same "not a question event" grounds. `timelineBridge`'s two arms **are still dormant —
neither #1223 nor [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) ever claimed them
here.** Both draw a different way: a **fifth** independent subscriber ([history page
bridge](conversation-timeline-store.md)) owns `historyPageReceived` (#1223) and, since #1259,
`historyRequestFailed` too, on its own channel subscription — folding each page's entries through
`translateTimelineEvent`'s *other* arms instead, the ones keyed by the entry's own `type`,
`messageReceived` (#1223's actual new case) among them. **Stale comments, still open:** the
`timelineBridge.ts` and `modalBridge.ts` prose at these two arms still describes the pre-decode shape and
says "the mapping is #1223's" (`timelineBridge`: "that is the whole point of a history entry carrying a
stored frame's `type` and `payload`"; `modalBridge`: "a page may CARRY a stored `modal_shown` among its
entries") — flagged as a verifier NIT on PR #1228 and again as a SHOULD FIX on PR #1229; neither blocked
ship, and neither has been fixed.

## Data flow

```
window → sendCommand({type:'requestHistory', payload:{conversation_id, cursor, limit}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isRequestHistoryPayload)
      → router.route(conversation_id)?.requestHistory(payload)
      → buildRequestHistory (fresh 3-key literal) → driver.sendMessage
        → pendingHistoryRequests.set(envelopeId, conversation_id)   [only after a successful send]

daemon → history_page frame → parseHistoryPagePayload (fail-closed, whole page)
      → decodeHistoryPage (#1227: per-entry payload decode, skip-not-fail) → { kind:'history-page', historyPage: DecodedHistoryPage, inReplyTo }
      → daemonConnection matches inReplyTo against pendingHistoryRequests
      → hit:  delete entry → DaemonEvent{ historyPageReceived, conversationId, entries: HistoryTimelineEntry[], cursor, atStart }
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
| `buildRequestHistory` | `Uint8Array` | May throw `WireEncodeError` (unpublished cursor length); the sole caller discards the caught object and emits a classified request failure. |
| `isRequestHistoryPayload` | `boolean` | A missing/mistyped field is rejected at the untrusted→trusted boundary; the command is dropped before reaching main logic. |
| `parseHistoryPagePayload` / `parseHistoryEntry` | `HistoryPagePayload` | Throws `WireDecodeError` on any malformed shape — non-array `entries`, one bad element, a missing/mistyped field, a non-object entry `payload`. Never a partial page. |
| `decodeHistoryPage` / `decodeHistoryEvent` (#1227) | `{ page: DecodedHistoryPage; skipped: number }` | Never throws. An entry of a type the timeline doesn't draw, or one whose payload fails its parser, is skipped (not counted as page failure); order preserved among survivors; an all-skipped page yields `entries: []`. |
| `parseInboundMessage` | frame-level | An oversized frame throws before any parse (`MAX_PLAINTEXT_BYTES`); the consumer's existing `catch` drops it with no event, no log. |
| `narrowHistoryRejectReason` | `HistoryRejectReason \| undefined` | Total; never throws. A non-record payload, an absent `code`, a non-string `code`, or an unrecognised one all yield `undefined` → `'unclassified'` at the IPC emit. |
| `requestHistory` (connection method) | `void` | Unavailable/unauthenticated and build/send failures emit `historyRequestFailed`; caught objects are discarded. No automatic retry. |
| `case 'history-page'` (consumer) | `void` | Absent or unmatched `inReplyTo` → dropped silently. A hit → exactly one `historyPageReceived`. |
| `case 'daemon-error'` (consumer, history tier) | `void` | A correlated refusal always settles the ask, including a code outside the five (`'unclassified'`). A miss falls through unchanged to the pre-existing `daemon-error` consumers. |
| Window | — | Both arms stay dormant/permanent-null across the four exhaustive bridges. `historyPageReceived` and (since [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259)) `historyRequestFailed` are claimed outside them, by #1223's/#1259's fifth subscriber, `historyPageBridge.ts` — see § The `DaemonEvent` arms above. |

## Security properties

Ticket carries `security-sensitive`; builder self-review verdict **PASS**, no MUST FIX findings (two
SHOULD FIX, both documentation-only — see below). #1227's own security review, on the payload-decode
stage: **PASS** (first pass FAIL — three MUST FIX findings, all fixed before ship — plus two SHOULD FIX,
both verified against the tree rather than taken on report; see below).

- **One boundary per direction, both named types.** Inbound: `parseHistoryPagePayload` /
  `parseHistoryEntry` / `narrowHistoryRejectReason` in `inboundMessage.ts` — `payload: unknown` never
  escapes them. Outbound: `isRequestHistoryPayload` in `commands.ts` gates every `requestHistory`
  command, and `buildRequestHistory`'s fresh three-key literal is the second bound that keeps a
  smuggled field off the wire regardless of what the guard admitted.
- **`conversationId` on both new events is client-owned, not boundary-derived** — sourced from this
  app's own outbound frame, held in main-process memory, and handed back; never parsed from an inbound
  payload. Naming a conversation is not authorization; the daemon validates it against its own
  registry and authorization is pairing at the Noise handshake.
- **An entry's `payload` was trusted in shape and untrusted in content at #1222 ship time (SHOULD FIX,
  documentation-only) — closed by #1227, which is the consumer this finding anticipated.** `payload`
  stayed opaque past #1222; #1227's `decodeHistoryEvent` is now the (sole) reader, and it reads through
  the same fail-closed live-lane parsers rather than trusting the shape. `HistoryTimelineEvent`'s
  docblock (events.ts) carries the untrusted-content warning forward onto every decoded field, so
  #1223 — the actual render consumer — inherits it from there rather than from the pre-decode type.
- **`payload` crossed by reference with a `__proto__` key surviving in it at #1222 ship time (SHOULD
  FIX, documentation-only) — also closed by #1227.** `decodeHistoryEvent` never spreads or
  `Object.assign`s the decoded payload; every arm is a fresh named-field literal built from named
  parser output, so no reference to the original `JSON.parse` result survives into what crosses IPC.
  Verified rather than assumed: #1227's security review re-checked that `optionalStringMap`
  (`toolUse.input`, the one daemon-keyed map on this path) type-checks every *value* before dropping
  `RESERVED_MAP_KEYS`, and a test pins a `__proto__` key built through an actual `JSON.parse` (a
  `{ __proto__: 'x' }` object literal creates no own property at all and would pin nothing) decoding
  inertly with no prototype pollution. `HistoryEntry`'s own docblock still carries the original warning
  for its remaining reader — the decoder itself.
- **The decode dispatch is a `switch`, never an object-literal table (MUST FIX, fixed before ship,
  #1227).** `type` is a stored, daemon-authored string nothing re-validates; `TABLE[type]` would be a
  lookup path on untrusted input (`'__proto__'` resolves to `Object.prototype`, truthy and then
  invoked). See § Payload decode above.
- **A per-entry skip diagnostic would be a log-write amplifier a hostile daemon drives directly (MUST
  FIX, fixed before ship, #1227).** ~1200 entries fit in one frame (#1222's own test), all could be
  malformed, and the frame can repeat — aggregating to one line per page keeps the rate at what the
  transport already runs at.
- **The mirrored `DecodedHistoryEvent`/`HistoryTimelineEvent` types shipped without the
  untrusted-text contract on their first draft (MUST FIX, fixed before ship, #1227).** A mirror that
  drops the plain-text-only warning its live `DaemonEvent` twin carries is exactly how an inherited
  "never used as X" contract goes false in a new consumer — and #1223 is precisely that consumer, with
  the DOM sink. Both docblocks now state it, naming every field it binds.
- **`unrecognizedMessage.raw` is the least predictable string on the union (SHOULD FIX, verified —
  #1227).** It's a bounded snippet of a line the daemon could not parse. Not a new exposure — it
  crosses verbatim on the live lane today and the daemon bounds it at construction — but the decode
  must not re-derive, trim or re-bound it; it doesn't.
- **No prompt can reach the window from history (addressed by construction, #1227).** `modal_shown` /
  `question_shown` have no arm in `decodeHistoryEvent`, so neither type can produce an event under any
  payload — closed for a future daemon that starts logging one and for a hostile one that plants one in
  a page alike. A replayed prompt answered "now" would be a resolution for a modal that closed hours
  ago; page forgery generally still closes one layer up, at the correlation gate.
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
  can leave an unanswered ask until connection interruption settles it. Only new
  qualifying user input can retry, so withholding cannot induce a download spin.
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

**#1227's payload-decode tests, added to the two files above:**

- Per-type decode, table-driven over all eleven types — a well-formed payload (including
  `conversation_id`) in, the expected fresh event literal out, via `toEqual` so a smuggled extra field
  reddens. Covers both enum-bearing arms and both optional-field arms (`toolUse.input`,
  `toolResult.resultDetail`, pinning `undefined` rather than `{}`/`''`).
- No `conversation_id` crosses on any arm; `session_transition`'s `previous_session_id` is dropped too.
- AC3 skip matrix: the eight drawn-nowhere-but-decoded-live types (`thinking_progress` since
  [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312), `rate_limited` since \#1318), an
  unseen type, and `modal_shown`/`question_shown` pinned outright with payloads that *would* parse on
  the live lane — every one yields an empty page from a one-entry page, `cursor`/`atStart` intact.
- AC4: a payload missing `conversation_id`, an out-of-set enum field, an empty-object payload — each
  skipped while a well-formed sibling in the same page survives; order preserved among survivors.
- Empty page and all-skipped page both cross as `entries: []`.
- A `__proto__` key in an entry payload, built through an actual `JSON.parse` (a bare object literal
  wouldn't pin anything — see § Security properties), decodes inertly and pollutes nothing.
- The skip diagnostic: only `event`/`code`/`count`/`hash`, no entry `type`/`id`/`ts`/payload field; no
  line emitted when nothing was skipped.
- `daemonConnection.test.ts` gains a type-only mutual-assignability guard between `DecodedHistoryEvent`
  and `HistoryTimelineEvent`, mutation-checked (a required field added to one union's `stallDetected`
  arm alone reddens `npm run typecheck`).
- The shipped #1222 fixtures move: `HISTORY_ENTRY` gains `conversation_id` so a page still has a
  surviving entry; the "carries an unrecognised type" / "carries a payload verbatim" tests invert into
  skip tests; the no-count-bound test drops its entry count from 1200 to 800 because a *decodable*
  minimal entry is larger than the old unparsed one, and 1200 of the new size overflowed
  `MAX_PLAINTEXT_BYTES` at encode.

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
  `historyPageReceived`/`historyRequestFailed` would be catalogued alongside every other arm; still
  unlisted as of #1223, since neither arm is claimed inside any of the four bridges this catalogue
  covers.
- [Inbound message decode — extension history](inbound-message-decode-history.md) — the `history_page`
  kind's place in the chronological account of every additive extension to `InboundDaemonMessage`.
- [Daemon error outcome](daemon-error-outcome.md) — the sibling narrower `HistoryRejectReason` mirrors
  and deliberately does not extend; see § The reject path above for why.
- [Command channel](command-channel.md) — the `requestHistory` `RendererCommand` member +
  `isRequestHistoryPayload` guard this channel's union gained.
- `docs/specs/architecture/1222-request-history-decode.md` — the full architecture spec, including the
  open questions (whether a correlated `message.too_long` is observed in practice; whether an
  outstanding ask needs a deadline, deferred to #1224 and its split-siblings) and the full security review
  this doc summarizes. [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) answers the
  deadline question in the negative by design: no timer, no backoff, a relay that merely withholds the
  frame leaves the ask at `requested` forever rather than spinning.
- `docs/specs/architecture/1227-decode-history-entries-into-typed-events.md` — the #1227 architecture
  spec: the sizing overage measured and accepted (call-site count and line total both exceed a size-S
  ticket's boundaries, with no split surviving the floor rule), the full security review (three MUST
  FIX findings fixed before ship), and the `## Revisions` section recording the four departures from
  plan — `decodeHistoryPage` returning `{ page, skipped }` rather than a bare page, the 1200→800 fixture
  count, and the two Open Questions both resolving as planned.
- [Conversation timeline store](conversation-timeline-store.md) — #1223, the render consumer. Draws a
  page via a fifth independent channel subscriber, `historyPageBridge.ts`, not by claiming
  `historyPageReceived` in `timelineBridge.ts` — see § The `DaemonEvent` arms above for why that arm
  stays dormant and its stale comment stays open. [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259)
  is the first sender, firing this ask once per conversation activation and claiming `historyRequestFailed`
  on the same subscriber; see [Internals § The opening
  ask](conversation-timeline-store-internals.md#the-opening-ask-1259) for the write paths.
