# Unrecognized-message diagnostic: decode the daemon `unrecognized_message` frame and render it as an expandable timeline row

**Size:** M (two slices — see § Scope) · **Security-sensitive:** yes, the transport slice (reviewed at the end) · **No ticket number:** this vertical was specified and shipped from the daemon-side change, not from a desktop board item, so the file is named for the feature rather than an issue. Do not back-fill a number.

Two commits on `feature/unrecognized-message`:

- **`0add6a4`** — the transport slice. Decode the frame into a typed `DaemonEvent`, shipped dormant. 12 files, 540 insertions.
- **`711d588`** — the render slice. Give it its first consumer, a durable timeline row that expands to show the payload. 8 files, 603 insertions.

Structurally this is #495 / #496 (the compaction-status vertical) with three deliberate divergences: the payload is wide rather than one bool, the render half is a **row inside `items`** rather than a scalar beside them, and the row is the repo's first expand-and-collapse. This spec is written as a delta against that pair and calls out each divergence where it lands.

## Design source

N/A. The mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) draws the populated steady-state Conversation Thread only, and this row surfaces a condition the design never anticipated — the daemon failing to understand its own upstream. Every transient and diagnostic thread surface on this project has shipped N/A-justified (#215 thinking, #277 empty-thread, #279 session banner, #286 session delimiter, #317 stall, #493 retry, #496 compaction). Code-review's visual-fidelity check is intentionally skipped; § 6 below is the design decision in its place, and it is expressed entirely in existing theme tokens — no new token, no colour literal.

## Files to read first

Read in this order. The first two entries are the whole design template; the rest are the local idioms this work lands in.

| Path | What to extract |
|---|---|
| `docs/specs/architecture/495-compacting-status-transport.md` | **The transport slice's template, verbatim.** Same seven-production-file shape, same fresh-literal emit discipline, same narrow-before-log ordering. Read it before anything else; the transport half below is a delta against it. |
| `docs/specs/architecture/496-compaction-indicator-render.md` | The render slice's template — and the one place the two verticals **diverge on purpose**. #496 added a scalar *beside* `items`; this one adds a row *inside* them. § 4 explains why. |
| `src/shared/wire/types.ts:57-63` | `EnvelopeType` — `'compacting'` at `:60`, `'unrecognized_message'` added after with its own comment. |
| `src/shared/wire/types.ts:341-386` | `CompactingPayload`, then the new `UnrecognizedMessagePayload` (`:368`) and `WireUnrecognizedSite` (`:386`). |
| `src/main/transport/inboundMessage.ts:490-534` | `parseCompactingPayload` then `parseUnrecognizedMessagePayload` (`:514`). |
| `src/main/transport/inboundMessage.ts:536-562` | `parseSessionTransitionPayload` — the closed-enum `reason` check the new `site` check is cloned from, including its `missing required field: <name>` message shape. |
| `src/main/transport/inboundMessage.ts:1046-1061` | The inbound `case 'unrecognized_message'`. Narrow **before** log; content-free diagnostic field set. |
| `src/main/transport/inboundMessage.ts:899` | The frame-level `MAX_PLAINTEXT_BYTES` guard. Runs before payload narrowing; the reason no length check is duplicated in the parser. |
| `src/shared/ipc/events.ts:146-176` | The new `unrecognizedMessage` `DaemonEvent` arm and the long docstring that records why it is a deliberate widening. |
| `src/main/daemonConnection.ts:630-648` | The emit. This inner switch has **no `assertNever`**, so the emit is not compile-forced and the round-trip test is the sole guard. |
| `src/renderer/src/store/threadTimeline.ts:20-27` | `SessionBoundaryReason`, then the new renderer-local `UnrecognizedSite` (`:27`). The re-declaration is deliberate — see § 4. |
| `src/renderer/src/store/threadTimeline.ts:56-83` | The `sessionBoundary` `ThreadItem` arm, then the new `unrecognizedMessage` arm (`:67-83`) and its comment block. |
| `src/renderer/src/store/threadTimeline.ts:335-362` | The new reducer arm, beside the `sessionBoundary` and `stallDetected` arms it borrows from. |
| `src/renderer/src/store/timelineBridge.ts:111-125` | The tenth owned arm. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:309-315` | `TimelineRow`'s exhaustiveness comment, now reading "six kinds". The comment records that the guard fired on this work. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:407-495` | The `unrecognizedMessage` row case, the `UnrecognizedRow` component, the two copy constants, and `unrecognizedSiteLabel`. |
| `src/renderer/src/screens/conversation/conversation.css:546-556` | `.tool-row__summary` — the ellipsis treatment the collapsed line reuses. |
| `src/renderer/src/screens/conversation/conversation.css:778-790` | `.screen-snapshot__screen` — the bounded-height scroll treatment the expanded blob reuses **byte for byte**. |
| `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` | Why the expanded flag is component state and not a store field. |
| `e2e/fixtures/launchPairedApp.ts:63, :110` | `SEEDED_ROW` and the fake daemon's `pushFrame` control surface, both used by the new spec. |

## Context

### The gap this closes

The daemon reads claude's structured output stream. Its parser recognises exactly three top-level message types — `assistant`, `user`, `result` — plus a fixed set of content blocks inside the first two. Everything else fell into a debug-level log line.

The production daemon runs at info level. It never prints that line.

So the failure mode was total silence. A claude release that moved something meaningful into a new top-level message type would produce **no trace anywhere** — nothing in the daemon's printed output, nothing on the wire, nothing for any client to show — and no client would be told that anything had been dropped. The most likely way for this client to break is a claude change it cannot see, and until now the only symptom would have been output quietly going missing.

The daemon now has two tiers instead of one:

1. A **measured known-ignored list** stays silent: `system` wholesale, meaning every subtype, plus `rate_limit_event`.
2. Everything else emits an `unrecognized_message` frame.

**`system` is ignored wholesale, not per-subtype, and that is the load-bearing choice.** `system/init` fires once per turn and `system/thinking_tokens` roughly ten times per turn. Matching per-subtype would let a new `system` subtype through, which sounds like the safer default until you count the rows: the noise would land on every single turn, and a diagnostic that fires constantly is one an operator learns to ignore. The wholesale ignore keeps the row rare enough to mean something.

### The measurement

The known-ignored list is measured, not guessed. On 2026-07-27, claude was driven directly on the bare structured-output surface: three turns each on haiku and on the default model (claude-opus-5), with one turn per run calling tools. Only `system` (both subtypes seen) and `rate_limit_event` appeared outside the recognised set.

The run also closed a standing open question: **claude does not echo the delivered prompt back as a user text message on this surface.** It does on the agent-run surface, and assuming the two behaved alike would have produced a duplicated prompt on every turn.

### Wire contract

Payload, all five fields always present, no `omitempty`:

| Field | Type | Notes |
|---|---|---|
| `conversation_id` | string | Dropped at the emit — single active conversation, the `turnState` convention. |
| `site` | closed enum | `line_type` \| `assistant_block` \| `user_block` \| `undecodable`. Where the parser met the thing. |
| `message_type` | string | **May be empty**, and only when `site` is `undecodable` — nothing decoded, so no type was ever read. |
| `raw` | string | **Not JSON.** A plain string. See below. |
| `truncated` | bool | Whether the daemon had to cut `raw`. |

Three facts drive the design and two of them are places where the obvious choice would be wrong.

- **`raw` is a string, not parsed JSON.** The daemon caps it at 16 KiB at construction, and a blob cut at a byte boundary is no longer valid JSON. Typing the field as JSON would make the truncated case — the case the flag exists for — undecodable. The client's own frame-level ceiling is `MAX_PLAINTEXT_BYTES` (65519 bytes, the v2 application-envelope cap superseding v1's 1 MiB), and the relay's socket-level frame cap of 1 MiB bounds bytes further upstream. Three independent bounds, none of them duplicated inside the parser.
- **No `turn_id`, and no turn lifecycle effect.** The daemon could not parse the message well enough to attribute a turn to it, so it does not pretend to. Receiving the frame opens, closes, and alters no turn.
- **Not a claude sub-state.** Its `stall` / `api_retry` / `compacting` neighbours report what claude is doing. This one reports a gap in the *daemon's own* mapping. That distinction is what makes the render half a durable row rather than a clearing status.

## Scope — why two slices and not one

The split is the #495 / #496 seam, taken for the same reason: the transport half ships dormant behind three exhaustive bridges, and the render half is a separate compile-atomic set.

**Transport slice**, seven production files: `types.ts` · `inboundMessage.ts` · `events.ts` · `daemonConnection.ts` · three bridges. The architect's "≥5 production files → split" gate trips, and it is the same measured false positive #495 recorded: the only real seam is decoder versus event-and-emit, which yields a first child of literally unreachable code and a second child of five files that trips the gate again. The three bridge edits are compile-forced — a new `DaemonEvent` arm breaks all three `assertNever` guards, so they cannot land separately without a red build.

**Render slice**, three production TS/TSX files plus one CSS file: `threadTimeline.ts` · `timelineBridge.ts` · `ConversationScreen.tsx` · `conversation.css`. A clean pass under the gate. No subset is independently shippable: a store-only child would be unreachable, and a view-only child would have no state to read.

## Part one — the transport slice (`0add6a4`)

### 1. `src/shared/wire/types.ts`

`'unrecognized_message'` joins `EnvelopeType` after `'compacting'` (`:63`), carrying a comment that names the distinction from its neighbours and points at the daemon-side source of truth.

Two new exports:

```ts
export type WireUnrecognizedSite = 'line_type' | 'assistant_block' | 'user_block' | 'undecodable'

export interface UnrecognizedMessagePayload {
  conversation_id: string
  site: WireUnrecognizedSite
  message_type: string
  raw: string
  truncated: boolean
}
```

`WireUnrecognizedSite` is a closed wire enum on the `WireSessionTransitionReason` model, which is what lets the decoder compare against literals instead of accepting any string.

The `UnrecognizedMessagePayload` docstring records, in this order: what the frame is and what silence it replaces; that it is deliberately not emitted for the known-ignored types, with the once-per-turn / ten-times-per-turn counts as the reason; that it is not a claude sub-state; that it is conversation-level with no `turn_id` and no turn-lifecycle effect; and that `raw` is the render payload, is a plain string because of truncation, and must never reach an HTML sink.

### 2. `src/main/transport/inboundMessage.ts`

- Import `UnrecognizedMessagePayload`.
- New union arm at `:209`: `| { kind: 'unrecognized-message'; unrecognized: UnrecognizedMessagePayload }`.
- A module-docstring paragraph (`:125-136`), peer of the `compacting` one above it.
- `parseUnrecognizedMessagePayload` at `:514`, immediately after `parseCompactingPayload`.
- `case 'unrecognized_message'` at `:1046`.

**The parser.** Five fields, fail-closed, no new helper:

```ts
const conversation_id = requireString(payload, 'conversation_id')
const message_type = requireString(payload, 'message_type')
const raw = requireString(payload, 'raw')
const truncated = requireBoolean(payload, 'truncated')
const site = payload.site
if (site !== 'line_type' && site !== 'assistant_block' && site !== 'user_block' && site !== 'undecodable') {
  throw new WireDecodeError('missing required field: site')
}
return { conversation_id, site, message_type, raw, truncated }
```

Four decisions in that block are worth naming, because each has an obvious wrong alternative:

- **`site` is a literal comparison, not `requireString`.** A bare string check would accept any string and defeat exactly the boundary that keeps a daemon-supplied value out of a render branch. The check is cloned from `parseSessionTransitionPayload`'s `reason` check at `:557`, message shape included: it names the failure category only and never interpolates the offending value.
- **`message_type` is required but may be empty.** `requireString` admits `''`, which is the wanted behaviour, because the `undecodable` site means nothing decoded and so no type was ever read. The decoder does **not** cross-validate the empty-implies-`undecodable` invariant. That is daemon-guaranteed, and enforcing it here would defend a failure nobody has observed.
- **`truncated` is type-checked, never truthiness-checked.** `false` is a value, not an absence. `requireBoolean` already carries that rule in its own docstring.
- **`raw` gets no length check.** The daemon truncates at construction — that is what `truncated` reports — and the frame-level guard at `:899` backstops the oversized case before narrowing ever runs. A third bound here would guard a line that cannot be reached.

The returned fresh five-field literal is what makes unknown server-added keys tolerated for forward-compatibility but not copied through, and it is prototype-pollution-safe as a side effect.

**The inbound case.** Ordering is load-bearing: **narrow first, log second**. A malformed frame throws and leaves no diagnostic record, so a hostile daemon cannot use a malformed field to write chosen bytes into the log. The diagnostic reuses the existing content-free field set — `event: 'inbound-decoded'`, `code: 'unrecognized_message'`, `bytes`, `hash` — and nothing decoded is logged. The comment at the case records the asymmetry that justifies the whole frame: the daemon deliberately logs nothing useful about the drop either, which is why it now crosses the wire instead.

### 3. `src/shared/ipc/events.ts` — the deliberate widening

```ts
| {
    type: 'unrecognizedMessage'
    site: WireUnrecognizedSite
    messageType: string
    raw: string
    truncated: boolean
  }
```

This is the widest arm on the union, and it is the one place this vertical genuinely departs from its `compacting` template. #495 could carry a single bool and win a structural guarantee for free: an arm with no string field cannot leak content. This arm cannot have that guarantee, because **the raw text is the render payload**. There is no summary that could replace it. The entire point is showing an operator the bytes we could not interpret, and a client-computed summary of bytes we do not understand is worthless by definition.

The precedent is `screenSnapshotReceived.text`, which crosses IPC for exactly the same reason and carries exactly the same warning. So the defended boundary moves upstream: it is the fail-closed decode in `parseUnrecognizedMessagePayload`, not this internal channel. Three bounds already cap the string before it arrives.

The docstring carries the consumer obligation in the same terms as its four siblings (`screenSnapshotReceived` / `conversationCreated` / `sessionTransition` / `queueState`): **`raw` and `messageType` are untrusted daemon-relayed content and must be rendered as plain text only** — never `innerHTML`, never `dangerouslySetInnerHTML`, never into an attribute or a URL. React escapes text children, so a `<pre>{raw}</pre>` is inert; those two sinks are the only ways to break that, and neither appears in the consumer.

`conversation_id` is dropped at the emit. `messageType` is allowed to be empty. Ships dormant.

### 4. `src/main/daemonConnection.ts`

`case 'unrecognized-message'` at `:630`, emitting a fresh literal with four named fields copied off the already-validated payload:

```ts
emitDaemonEvent(sink, {
  type: 'unrecognizedMessage',
  site: inbound.unrecognized.site,
  messageType: inbound.unrecognized.message_type,
  raw: inbound.unrecognized.raw,
  truncated: inbound.unrecognized.truncated
})
```

Never `{ type: 'unrecognizedMessage', ...inbound.unrecognized }`. The spread would smuggle `conversation_id` across IPC today and any future decoder field tomorrow. That discipline earns its keep here more than on any other arm: this is the one whose payload is unbounded daemon-relayed JSON, so the field list must be the one an operator agreed to render, not whatever arrived.

Deliberately stateless — no dedup, no coalescing, no edge memo. A repeat is a real repeat.

This inner switch has no `assertNever`, so a missing or wrong emit compiles silently. The round-trip test is the sole guard, and one of its assertions is a key-set check written specifically to fail if someone reaches for the spread.

### 5–7. The three renderer bridges

All three arms ship as no-ops. They do not share a shape — each file's local idiom is cloned rather than one shape three times.

| File | Shape | Where |
|---|---|---|
| `daemonEventBridge.ts` | Own `case` + comment + `return null` | `:150`, after `compacting` |
| `modalBridge.ts` | One added fall-through label + one sentence in the shared comment | `:97`, after `compacting` |
| `timelineBridge.ts` | One added fall-through label | In the null cluster, promoted out by the render slice |

Each comment names the eventual consumer. The modal one is worth quoting because it states the rule rather than the fact: a diagnostic an operator reads at leisure is emphatically not a modal, since nothing is waiting on an answer.

## Part two — the render slice (`711d588`)

### 1. `threadTimeline.ts` — a row, not a scalar

**This is the divergence from #496.** `stalled`, `apiRetry` and `compacting` are scalars sitting *beside* `items`, because each is a live condition with a clearing edge: it is true for a while, then it stops being true, and the indicator disappears. An unrecognized message has no clearing edge. It is a discrete historical event. It happened, at a point in the conversation, and it stays there.

So it is a `ThreadItem`, the sixth kind:

```ts
| {
    kind: 'unrecognizedMessage'
    site: UnrecognizedSite
    messageType: string
    raw: string
    truncated: boolean
  }
```

**`UnrecognizedSite` is re-declared renderer-locally** (`:27`) rather than imported from the wire types, following exactly what `SessionBoundaryReason` does. Three things fall out of that: this reducer stays wire-free, the bridge assigns `event.site` with no cast because the literal unions are identical by construction, and a future fifth wire site becomes a compile error here rather than a silently-passed-through string.

**No `turnId`**, following `userText` and `sessionBoundary`. The daemon cannot honestly attribute one, so neither does the item.

The `ThreadEvent` arm is field-for-field identical to the item, which keeps the bridge a filter plus a fresh copy rather than a remap.

**The reducer arm** (`:338`) is a fresh tail-append with `phase`, `stalled`, `apiRetry` and `compacting` all spelled out and carried through unchanged — the file's house style, never a `...state` spread.

**Never coalesced, and that is the one decision worth defending.** Every other repeat-prone thing in this reducer collapses: consecutive assistant deltas merge into one run, a redundant stall onset is a same-reference no-op, a verbatim repeated compaction edge returns the same state object. This one must not, because **how often it fires is exactly the number that tells an operator to go fix something**. Collapsing repeats would hide the only signal the row exists to carry. The transport is stateless for the same reason, so the contract holds end to end: N frames make N rows.

**Not turn activity.** The arm is not in the clear set. It clears neither the stall, nor the retry, nor the compaction, and it opens and closes no turn — `phase` is untouched on every path, matching the daemon's inability to attribute one.

### 2. `timelineBridge.ts` — the tenth owned arm

`case 'unrecognizedMessage'` moves out of the null fall-through cluster into an owned arm at `:111`, returning a fresh literal with four named fields. Never `return event`, matching the `compacting` discipline and the transport emit's.

No normalisation. Deciding what an unrecognized message *means* is the reducer's job and deciding how it *looks* is the row's, so the translator stays a pure rename. `site` assigns with no cast.

The `translateTimelineEvent` docstring's arm count goes from nine to ten.

`daemonEventBridge.ts` and `modalBridge.ts` keep their no-op arms untouched, and so do their tests. Only the timeline gains a consumer.

### 3. `ConversationScreen.tsx` — the repo's first expand-and-collapse

`TimelineRow` gains a `case 'unrecognizedMessage'` returning `<UnrecognizedRow item={item} />`. The switch's exhaustiveness comment updates from five kinds to six, and records that the guard did its job: the arm arrived as a compile error at this switch rather than as a silently unrendered item.

**No `data-thread-role`.** The row is identified by class, like `.session-delimiter`. Attributing it to assistant, user, or tool would be a lie — claude did not say this, the daemon did.

**Built specific, not generic.** There is no `<details>` anywhere in the repo to reuse, and no second caller to justify an abstraction, so a reusable collapsible would be speculative work. When a second one arrives, extract then.

**A real `<button>` with `aria-expanded`, not a div with a click handler.** Keyboard activation and screen-reader semantics come for free rather than being re-implemented and half-missed. The Playwright spec pins the Enter path specifically, because that is the assertion that fails if the element is ever downgraded to a div.

**State is component-local `useState`** — a single transient boolean, which ADR 0006 puts in the component and never in the store. It resets to collapsed on remount for free, which is the wanted behaviour: a diagnostic should not stay expanded across a screen remount. Two rows open independently, which the e2e spec asserts.

**Collapsed markup**, one line: a decorative warning glyph marked `aria-hidden`, the fixed label, the offending type in mono, and the drop-site label pushed to the trailing edge. **When `messageType` is empty the slot is omitted entirely**, rather than rendering an empty pair of quotes.

**Expanded markup**: `<pre className="unrecognized-row__raw">{item.raw}</pre>`, plus a truncation note shown only when the daemon actually cut the payload, so the reader knows the JSON is incomplete by design rather than malformed at the source. When collapsed, the payload is **absent from the DOM**, not hidden by CSS.

Three new exports:

- `UNRECOGNIZED_COPY = 'Unrecognized message'` — the collapsed row's fixed label.
- `UNRECOGNIZED_TRUNCATED_COPY = 'Payload truncated by the daemon.'` — the note under a cut payload.
- `unrecognizedSiteLabel(site)` — a total function over the closed union returning `'whole message'` / `'assistant block'` / `'user block'` / `'could not be decoded'`.

All three are **client-owned copy**. That is the mechanism, not a nicety: the daemon's `site` value *selects* a string but never *becomes* one, which is what keeps a daemon-supplied value out of the rendered chrome. The function is exhaustive over the union, so a future fifth site is a compile error rather than a blank slot.

**Safety, restated at the component.** `raw` and `messageType` are the most untrusted strings the timeline holds. Both reach the DOM only as auto-escaped React children: no `dangerouslySetInnerHTML`, no attribute value, no URL. A unit test feeds a hostile `messageType` through and pins the escaped output.

### 4. `conversation.css` — nine rules, no new tokens

Appended at the end of the file. Token names only, no colour literal, no new theme token.

- `.unrecognized-row` — a column flex wrapper.
- `.unrecognized-row__summary` — the collapsed line. A real button reset to look like a row rather than a control: outlined, on the container-high surface, body-small type, left-aligned, full width, with a hover state one surface level up.
- `.unrecognized-row__glyph` — the warning mark, in the error role. Decorative only; the label carries the meaning.
- `.unrecognized-row__label` — never shrinks, so the daemon-supplied type beside it is what gives way under pressure.
- `.unrecognized-row__type` — **`.tool-row__summary`'s ellipsis treatment** plus `min-width: 0` and a mono face. Both solve the same problem: one unbounded untrusted string on one line.
- `.unrecognized-row__site` — pushed to the trailing edge with `margin-left: auto`. Client-owned copy from a closed enum, so it is bounded and never needs to ellipsize.
- `.unrecognized-row__raw` — **`.screen-snapshot__screen`'s treatment, copied property for property**: `max-height: 240px` with internal scroll, `white-space: pre`, mono, on the container-high surface. That rule already solves this exact problem, which is a large dump shoving the composer off screen.
- `.unrecognized-row__truncated` — the muted caption treatment.

The two reuses are the substance of this section. Neither is a coincidence of styling: the collapsed line and the tool summary both bound an untrusted string on one line, and the expanded blob and the terminal snapshot both bound a large dump inside a scroll region. Reaching for the existing rule is cheaper *and* more correct than inventing a fourth way to do it.

## State + concurrency model

**The transport holds no state, and that is the design.** No dedup, no coalescing, no timers, no last-value memo. The per-frame dispatch is already stateless, so the "N frames, N events" contract comes for free — the risk is a developer *adding* an edge memo as a perceived optimisation, not omitting one. The no-dedup round-trip test exists to make that addition fail loudly.

**The reducer holds one item per frame**, appended, never merged. Unlike every other scalar arm, there is no same-reference no-op path here: a fresh append is always a change.

**The row holds one boolean per instance**, in component state. Per-row and not shared, so two rows open independently, and it resets on remount.

No new async tasks, subscriptions, listeners, or teardown paths on either slice. The frame arrives on the existing decrypted-message path and dispatches synchronously; the event arrives on the `onDaemonEvent` subscription `useTimelineBridge` already owns.

**Unbounded growth is real but bounded in practice.** Rows accumulate for the life of the conversation and each holds up to 16 KiB of text. A hostile or badly-broken daemon flooding the frame would grow the timeline. That is the same exposure every appending item kind already carries, the row is rare by construction (the whole point of the measured known-ignored list), and no per-conversation item cap exists anywhere in this store today. Adding one here would be a defence against a failure nobody has observed, and it would belong to the store as a whole rather than to this kind.

## Error handling

Fail-closed at the decoder, and only at the decoder:

| Input | Result |
|---|---|
| Non-object payload (`null`, array, string) | `WireDecodeError('malformed unrecognized_message payload')` |
| `site` absent, unknown, empty, or not a string | `WireDecodeError('missing required field: site')` — the closed-enum check catches all four |
| `conversation_id` absent or not a string | `WireDecodeError('missing required field: conversation_id')` |
| `message_type` absent or not a string | Throws. **Empty is fine; missing is not.** |
| `raw` absent, an object, a number, or `null` | Throws. Never coerced, never defaulted |
| `truncated` absent or not a boolean (`0`, `1`, `'false'`) | Throws. The check is on the type, never truthiness |
| `truncated: false` | **Decodes.** `false` is a value, not an absence |
| Unknown server-added key (e.g. a spurious `turn_id`) | Tolerated, not copied through |
| Oversized frame | Covered by the frame-level `MAX_PLAINTEXT_BYTES` guard, which runs before narrowing |

Never a partial value. Error messages name the failure category only and never interpolate a value — the `raw` blob is unbounded and model-adjacent, and the `conversation_id` is conversation-correlating.

A malformed frame is dropped without emitting and **without throwing out to the caller**: the existing decode-path handling catches it, which the round-trip test pins directly.

Downstream there are no new failure modes. The reducer is total over the widened union and non-throwing. The bridge's `assertNever` is a compile-time guard, not a runtime path. The row has no error state.

## Testing strategy

House convention is test-first. Both slices landed with a failing test per criterion.

### Transport slice — five test files

**`src/shared/wire/types.test.ts`** — wire vocabulary. `'unrecognized_message'` is assignable to `EnvelopeType`; the payload has exactly its five fields and **no `turn_id`**; the site enum is closed over exactly four values; an empty `message_type` is admitted; and `raw` is a plain string — pinned by a test that builds a truncated blob and asserts `JSON.parse` on it **throws**, which is the whole justification for the string typing made executable. ⚠ These are compile-only red: vitest strips type annotations, so the red state is `npm run typecheck`, not a failing run.

**`src/main/transport/inboundMessage.test.ts`** — recognition and fail-closed, twelve tests across two describes. Recognition covers the full narrow, all four sites in a loop, the empty `message_type`, `truncated: true`, `raw` carried verbatim, and an unknown extra key tolerated but absent from the result. Fail-closed covers each field with its own test, grouping the wrong-type traps together: `site` as absent / unknown / empty / numeric / null; `truncated` as `'false'` / `0` / `1` / null.

**Diagnostic-log tests** in the same file, and they are the sharpest ones in the slice. A frame carrying a secret conversation id and a secret string inside `raw` is decoded, and the emitted record is asserted to have **exactly** the key set `bytes, code, event, hash, seq, ts` — then the raw line is asserted not to contain the conversation id, the secret, or even the message type. A second test pins that the malformed path logs **nothing at all**.

**`src/main/daemonConnection.test.ts`** — five round-trip tests, the sole guard on the non-compile-forced emit. The four display fields cross and `conversation_id` does not; an empty `messageType` crosses verbatim; **two identical frames emit two events** (the no-dedup pin); a payload carrying an extra `smuggled` field produces an event whose sorted key set is exactly the five modelled properties and whose serialisation does not contain the smuggled value (the anti-spread pin); and a malformed frame emits nothing and throws nothing.

**The two dormant bridge tests** — one assertion each, in the null-returning describes.

### Render slice — three unit files plus one Playwright spec

**`threadTimeline.test.ts`** — eight reducer tests. A row carrying all four fields; the empty-type and truncated shapes carried verbatim; **three identical events make three rows**; the row does not coalesce into an adjacent assistant delta and a delta after it opens a fresh run; `phase` is untouched from both `idle` and `thinking`; a row after a stall, a retry and a compaction leaves all three set (it is not turn activity); arrival order among other kinds; and no `turnId` property.

**`timelineBridge.test.ts`** — two owned-arm tests: all four fields translate, the result is `not.toBe` the input (the fresh-literal discipline), and the empty-type/truncated shape translates verbatim.

**`ConversationScreen.test.tsx`** — nine row tests. The collapsed markup carries the label, the type and the site label; it is a real `<button>` with `aria-expanded="false"`; the raw payload is **absent from the markup**, not merely hidden; an empty type omits the slot entirely; there is no `data-thread-role`; a hostile `messageType` containing an image tag renders escaped; all four site labels are pinned against the exported function; three items render three summaries; and the truncation note stays out of the collapsed row.

**`e2e/unrecognized-message.spec.ts`** — one Playwright test covering what `renderToStaticMarkup` structurally cannot. The row holds its open state in component state, so static rendering only ever sees it collapsed; only a real DOM can prove it opens, and opens on the keyboard as well as the mouse.

It drives the whole client path — Noise wire, decode, IPC, bridge, reducer, row — by pushing an unsolicited frame through the fake daemon (a server push like `stall`, never bundled onto a reply). Then it asserts: the collapsed row is visible with `aria-expanded="false"` and a distinctive needle inside `raw` is **not** in the DOM; a click expands it and the needle appears; a second click collapses it and the payload leaves the DOM again; **focusing the button and pressing Enter does exactly what the click did**; a second, differently-shaped frame (truncated, undecodable, no readable type) makes a **second row rather than merging**; that row's type slot is absent; the truncation note appears only once expanded; and the first row is still open, proving the state is per-row.

Secret hygiene follows the sibling specs: every assertion reads DOM text, attributes and class locators only, and the pairing plumbing stays inside the fixture.

### Gates

- `npm test` — **130 files, 2089 passing, 3 skipped.** Green.
- `npm run typecheck` — clean on both the background and window projects.
- `npm run e2e` — **21 of 21 green**, including the new spec. (The `real-*` specs are excluded by filename from this config and run only under the real-claude config.)

## Known defects

None outstanding. Two were found during the documentation pass and fixed before this spec was filed; both are recorded here because each is the kind of thing a typechecker cannot catch.

**A misplaced docstring in `src/shared/wire/types.ts` (fixed).** The new `WireUnrecognizedSite` block initially landed *between* `WireSessionTransitionReason`'s docstring and its declaration, orphaning that docstring so it documented the wrong type. Nothing broke and typecheck was clean — a comment-attachment problem, not a type problem — but hover help for `WireSessionTransitionReason` was silently wrong. Fixed by moving the new block below that declaration. The lesson generalises: inserting a type immediately *above* an existing declaration is the one edit position that can silently steal its documentation.

**A stale size-cap premise, inherited from the plan (fixed).** The original plan justified the daemon's 16 KiB `raw` cap as leaving "roughly eight times headroom" under a 1 MiB frame ceiling. That figure is v1's application-envelope cap, which **v2 superseded**: the binding limit is `MAX_PLAINTEXT_BYTES` = 65519 bytes (`src/shared/wire/types.ts:30`), and 1 MiB is now only the relay's outer WebSocket frame cap. The cap value itself is unaffected and still comfortable — 16 KiB is roughly a quarter of 65519 — but the *reasoning* recorded in several comments was arithmetic against the wrong number. Corrected in the daemon parser, the daemon payload doc, `docs/protocol-mobile.md`, and the three desktop comments that repeated it. Worth noting because a safety margin justified against a superseded limit is exactly the sort of claim that survives review by looking rigorous.

## Open questions

- **A cap on accumulated rows.** None exists, deliberately. See § State + concurrency model. If the frame ever proves noisy in practice, the fix belongs to the timeline store as a whole and not to this kind — and the fact that it fired often enough to need a cap is itself the signal the row exists to deliver.
- **Whether the known-ignored list stays right.** It is measured, not derived, so a claude release could move something meaningful into `system` and it would stay silent by construction. That is a daemon-side contract with a matching daemon peer (ADR 0002), re-measured on the daemon's schedule, not something this client can compensate for.
- **No `aria-live`.** The row inherits the house-wide gap that `ThinkingIndicator`, `StallIndicator`, `ApiRetryIndicator` and `CompactingIndicator` all share: a screen reader is not announced when it appears. Explicitly not a gate here — fixing it would touch four components this work otherwise leaves alone.
- **Whether a second expand-and-collapse extracts a shared component.** Not yet. There is one caller, and a reusable collapsible with no second caller would be speculative. When the second arrives, `UnrecognizedRow` is the reference.
- **Copy wording.** `'Unrecognized message'`, `'Payload truncated by the daemon.'` and the four site labels are the developer's call, the latitude `STALL_COPY`, `API_RETRY_COPY` and `COMPACTING_COPY` all took. The e2e spec pins the literals, so a silent change fails a test rather than drifting.

## Security review

**Verdict:** PASS, with one accepted widening.

**Findings:**

- **[Trust boundaries]** No findings. The untrusted-to-trusted boundary is one explicit function, `parseUnrecognizedMessagePayload`, reached only through `parseInboundMessage`'s `case 'unrecognized_message'`. Downstream code holds the narrowed `UnrecognizedMessagePayload` / `DaemonEvent` types only; there is no second parse site, and `raw` is never parsed as JSON anywhere in the client. The `site` closed-enum check is the load-bearing part: it is what keeps a daemon-supplied string out of a render branch, and a bare `requireString` would have defeated it silently.
- **[Tokens, secrets, credentials]** Not applicable by construction. This path touches no token, key, or credential. It reads five fields off an already-decrypted frame and forwards four.
- **[File / storage operations]** Not applicable. No filesystem access, no path construction from wire input, no persistence. The row lives in renderer memory for the life of the conversation.
- **[Inter-process / Electron attack surface]** **One accepted widening, and it is the finding of this review.** The arm carries `raw` — unbounded, unstructured, model-adjacent JSON — across IPC, which is a real departure from `compacting`'s single-bool arm and its free structural guarantee. It is accepted for the same reason `screenSnapshotReceived.text` was: the raw text *is* the render payload, and no summary could replace it, because the whole point is showing an operator bytes we could not interpret. Three compensating controls: the fail-closed decode upstream, three independent length bounds (16 KiB at daemon construction, 65519 bytes at the frame guard, 1 MiB at the relay socket), and a consumer that renders both untrusted strings as auto-escaped React children only. No new `contextBridge` API, no new `ipcMain` handler, no widening of the renderer's capability. The fresh-named-field-literal rule at the emit is what keeps the field list to the four an operator agreed to render, and it is pinned by the key-set assertion rather than left to review vigilance.
- **[Cryptographic primitives]** Not applicable. Decode runs after Noise decryption on the existing path; no primitive, key, or nonce is selected, derived, reused, or compared.
- **[Network & I/O]** No findings. No new socket, connection, timeout, or reconnect path. Oversized-frame resistance is inherited from the frame-level guard, which runs before payload narrowing. A hostile relay can drop, delay, reorder, or flood these frames; flooding grows the timeline, which is discussed under § State + concurrency model and is the same exposure every appending item kind carries. The transport itself holds no state and allocates nothing per frame beyond the decoded literal.
- **[Error messages, logs, telemetry]** No findings, and one ordering that must survive any future edit. The diagnostic **narrows before it logs**, so a malformed frame throws first and leaves no record — a hostile daemon cannot use a malformed field to write chosen bytes into the diagnostic log. The logged field set is the existing content-free one, asserted as an exact key set, and the test additionally proves that neither the conversation id, nor a secret inside `raw`, nor even the message type appears anywhere in the line. `WireDecodeError` messages name the category only. This rule binds harder here than anywhere else on the file, and for a pointed reason: the frame exists precisely *because* the daemon's own log could not be trusted to carry this safely either.
- **[Concurrency]** No findings. Nothing async is introduced on either slice: no task, timer, listener, `AbortController`, or teardown path. The explicit no-state design at the transport means no shared mutable state and therefore no check-then-act race. The row's expanded flag is per-component and touched only by its own click handler.
- **[Threat model alignment]** Addressed. **Hostile daemon response** is the applicable threat and the one both slices defend: every field is type-checked, the enum is closed, a partial value is never returned, unknown keys are dropped rather than copied, the failure mode is a throw with no side effect and no log, and the two untrusted strings reach the DOM only through React's escaping — pinned by a test that feeds an image tag with an inline handler through `messageType` and asserts the escaped output. **Malicious relay** is on-path but content-blind. **Renderer compromise reaching the transport** is unchanged: data moves outward only. **Token theft from disk** is out of scope; nothing here persists.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-27
