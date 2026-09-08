# #1319 — carry the usage-limit reading across to the window

The second step for `rate_limited`: #1318 decoded the frame into an inbound arm that stops in the
background process; this slice emits it as a `DaemonEvent` so renderer state can hold it. The same
carry step `thinking_progress` took at #1313, `question_shown` at #885 and `modal_shown` at #871.

## Files read

- `src/shared/wire/types.ts` → `RateLimitedPayload` — the five wire fields and the contract clauses
  this arm inherits: open `status` / `limit_type`, the "a frame is not proof anything was blocked"
  reading, `resets_at` as claude's unvalidated number (never a scheduling input), and
  `truncated_fields`' `null`-is-a-value nullability.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`'s `rate-limited` arm,
  `parseRateLimitedPayload` — what #1318 produced, why it takes no `FrameTimestamp`, and the
  fail-closed posture the emit sits behind.
- `src/main/daemonConnection.ts` → the inbound switch's `thinking-progress` case — the immediately
  preceding arm and the shape precedent for the emit (fresh literal, fields by name, no `daemonTs`,
  explicitly stateless); `model-announced` beside it for the same rules one slice older.
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent` — the log-free sink the emit goes through.
- `src/shared/ipc/events.ts` → `BaseDaemonEvent`, its `thinkingProgress` arm (the union's newest
  member, appended at #1313), `DaemonEventTimestamp` / `WithDaemonTs` — where the new arm lands and
  why it carries no `daemonTs`.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`;
  `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`;
  `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`;
  `src/renderer/src/store/questionBridge.ts` → `translateQuestionEvent` — the four `DaemonEvent`
  switches ending in `assertNever`. Re-derived from the tree at `fa22507` per the ticket's
  instruction rather than trusted from it: no fifth has appeared. `timelineBridge`'s other two
  `DaemonEvent` switches (`timelineTargetFor`, `timelineWriteTarget`) and `threadTimeline`'s
  `reduceTimeline` are **not** in the set — the first two end in `default`, and the third switches
  `ThreadEvent`, not `DaemonEvent`.
- `src/main/daemonConnection.test.ts` → the `thinking_progress` describe block and
  `thinkingProgressPlaintext` — the round-trip test shape this slice clones.
- `src/renderer/src/store/questionBridge.test.ts` → the inverse-filter table's
  `expect(others).toHaveLength(42)` — the arm-count pin that moves with this union member.
- `docs/knowledge/features/daemon-event-channel-sealed-union.md` — the union's standing rules: a
  member reuses its wire payload type where one exists, and `DaemonEvent` / `SessionAction` stay
  separately declared per layer. Neither is disturbed (this arm carries scalars rather than
  `RateLimitedPayload`, because one of the five wire fields deliberately does not cross).
- `docs/specs/architecture/1313-thinking-progress-ipc-carry.md` — the same slice one frame earlier;
  its Design and Security-review sections are the template.
- `docs/specs/architecture/1318-rate-limited-decode.md` § Security review — the SHOULD FIX obligation
  #1318 handed forward to this slice (`resets_at` is never a scheduling input), discharged below.

## Design source

**Figma:** N/A — this slice adds no rendered surface. Nothing in the window draws the reading after it
lands; the store slice is #1320 and the render slice is #1321.

## Context

The daemon's `rate_limited` frame is its report that claude's usage-limit window is in a state other
than the one measured-benign one. #1318 narrowed it into `InboundDaemonMessage`'s `rate-limited` arm,
where it stops: `daemonConnection`'s inbound switch has no catch-all, so an unclaimed kind is dropped.
This slice claims it and emits a `DaemonEvent`, leaving the reading where a renderer store can reach
it. It ships **dormant** — the four exhaustive bridges no-op it until #1320.

**Sizing — six production files, one over the ceiling, stated rather than split.** The arm on
`BaseDaemonEvent` compile-forces a case in each of the four `assertNever`-closed bridges, so the
minimum landable change is `events.ts` + `daemonConnection.ts` + four bridges. The only cut that
divides it — arm plus four bridge no-ops first, emit second — produces a first slice whose one
deliverable (a union arm nothing emits) is consumed by exactly one sibling in the same family. That is
the floor rule, and the floor beats the ceiling: merged back, overage recorded here, built as one
ticket. Every other boundary holds — no new exported type (one arm on an existing union), five
consumer edits, four acceptance criteria, no new reject branch, ~530 lines of total written work.

No ADR is warranted: this arm settles nothing the union's existing rules do not already decide.

## Design

**The arm.** Appended to the end of `BaseDaemonEvent`, after `thinkingProgress`:

```ts
| {
    type: 'rateLimited'
    conversationId: string
    status: string
    limitType: string
    resetsAt: number
  }
```

Four of the wire's five fields, snake→camel per the union's standing convention.

- `truncated_fields` **does not cross.** Nothing consumes it: the eventual surface renders no
  daemon-authored string at all — it uses `status` and `limitType` as lookup keys into client-owned
  copy and falls back to generic wording — so a value the producer cut simply misses the lookup and
  falls back, which is the same outcome an unrecognised value already gets. There is nothing on screen
  for a truncation marker to qualify. A field crosses when something needs it, not before.
- **No `daemonTs`.** #1318's decode arm deliberately takes no `FrameTimestamp`: that mix-in marks the
  arms `decodeHistoryEvent` draws, which need (`type`, `ts`) as the join key between a served page and
  the live stream, and #1318 keeps this type armless there, so there is no page half to join against.
  `thinkingProgress` and `modelAnnounced`, not `apiRetry`, are the precedent for the literal's shape.
- `conversationId` is **required**, never optional — an optional routing key invites
  `?? activeConversation` fallbacks, the misattribution the per-conversation work exists to remove.
- `status` and `limitType` **stay open strings.** The daemon did not close either set and states the
  reason (the value set beyond the one measured-benign status is unmeasured); narrowing them here
  would re-introduce on the IPC boundary exactly the drop #1318's decoder avoids on the wire.
- `resetsAt` crosses as a plain `number`, unvalidated in both directions, `0` meaning "claude did not
  report one" and not the epoch — #1318's posture, unchanged, because this boundary can say only that
  the value is a number.

**The arm's contract** (docblock on the union member, in the file's established style). Beyond the
above it records, per AC4:

- `status` / `limitType` are **claude-authored open strings that crossed the subprocess trust
  boundary** — usable only as lookup keys for client-owned copy, never rendered verbatim, never an
  authorization signal, never a filename, a cache key or a lookup path.
- `conversationId` is a **daemon-asserted routing key**; if a consumer indexes by it, the index is a
  `Map`.
- **A frame is not proof anything was blocked** — the daemon's own named realistic client bug,
  restated here because the wording decision is made against this arm rather than against the wire
  type.

**Two divergences from `RateLimitedPayload`'s docblock, named rather than left to collide.** The wire
type says the two strings are "safe to render as inert text" and "never used as a Map key"; this arm
says the opposite of each, and both inversions are deliberate. The wire docblock states what is safe
*in general* at a boundary with no consumer in view; the arm states what this client's consumer will
actually do. Rendering is *tightened*: nothing on the eventual surface draws a daemon-authored string,
so verbatim rendering is out even though it would be safe. Lookup is *loosened*, and the reconciling
distinction is what the key resolves to — the wire's prohibition targets a key that reaches a
**resource** (a filename, a path, an icon URL, a cache entry), where an attacker-chosen value escapes
the program's own constants; a key into a client-owned copy table selects among strings this client
wrote, an unmatched key falls back to generic wording, and a `Map` carries no prototype chain to
pollute. The arm's docblock says this in as many words so a reader meeting both contracts is not left
to guess which one binds.

**The emit.** A `case 'rate-limited':` in `daemonConnection`'s inbound switch, placed directly after
`thinking-progress` so the switch mirrors `InboundDaemonMessage`'s own arm order. It builds a fresh
five-property literal with each field copied **by name** from `inbound.rateLimited` — never a spread
of the decoded record, so a decoder that later grows a field cannot smuggle it across IPC, and so
`truncated_fields` cannot ride along by accident. That switch has no `assertNever`, so nothing
compile-forces this case; the round-trip test is what guards it, which is why it is the first test
written.

**Statelessness is the contract, not an omission.** No dedup, no coalescing, no timer, no last-value
memo, and none keyed by `conversationId` — one event per decoded frame, verbatim repeats included. The
daemon re-reports the window once per run whatever its state, and a suppressor here would eat the
re-report that says the reading is still current. Nothing on this leg reads `resetsAt` as a delay: the
inherited rule is **never schedule, allocate or iterate from it**, and the one mutable-state
"optimisation" that would tempt a reader — a per-conversation memo — is refused for the same reason
#1313 refused it.

**The four bridges.** Each ends its `DaemonEvent` switch in `assertNever`, so each needs a case or
`npm run typecheck` reddens; all four land in this commit.

| Bridge | Disposition |
|---|---|
| `translateDaemonEvent` (`daemonEventBridge.ts`) | PERMANENT no-op — the session store holds *connection* status, and a usage-limit window is orthogonal to whether the socket is up: turns still run during the one measured non-benign status. Folding a quota reading into a connection scalar is precisely the "you are blocked" overclaim the wire names as the realistic client bug. Own case, appended before `default`. |
| `translateTimelineEvent` (`timelineBridge.ts`) | DORMANT — whether the reading draws as thread chrome (the `apiRetry` / `compacting` / `thinkingProgress` route) or through a subscriber of its own (the `questionShown` route) is #1320's call. Joins the existing null fall-through group. |
| `translateModalEvent` (`modalBridge.ts`) | PERMANENT no-op — nothing daemon-side is waiting on an answer and there is no `modal_id` to resolve it against. Joins the null group. |
| `translateQuestionEvent` (`questionBridge.ts`) | PERMANENT no-op — unsolicited, nothing outstanding, no answer to give: the `slashCommandList` / `modelList` reading of that group, not the history one. Joins the null group. |

The set was re-derived from the tree, not trusted from the ticket. `timelineBridge`'s
`timelineTargetFor` and `timelineWriteTarget` switch `DaemonEvent` but end in `default`, so neither is
compile-forced and neither gains a case while the arm routes nowhere; `threadTimeline`'s
`reduceTimeline` switches `ThreadEvent` and is not in this family at all.

**No store is written differently than before this slice** (AC3). All four translators return `null`,
and `conversationRouter`'s `record` learns only from `conversationsReceived` and
`conversationCreated`, so the new arm's `conversationId` reaches no index either.

## State + concurrency model

None added. The change is one union member, one synchronous `switch` case that calls the existing
`emitDaemonEvent`, and four `return null` cases. No task is launched, no timer set, no listener
registered, no store slice created — so there is nothing to cancel, nothing to tear down on window
close, and no check-then-act window across an `await`. The inherited `resets_at` scheduling trap is
refused rather than merely unused: no `setTimeout` is derived from it here or anywhere on this leg.

## Error handling

Inherited, unchanged. `parseRateLimitedPayload` is fail-closed upstream: a missing or mistyped field
throws `WireDecodeError`, which `parseInboundMessage`'s caller already catches and drops without
emitting — so a malformed frame produces no event and no throw, and the emit is reached only with an
already-validated payload. This slice adds no new failure mode and no new error surface: the emit
cannot fail, and the four bridges return `null` rather than throwing.

## Testing strategy

Vitest only (node environment). No renderer render and no Playwright spec: nothing is drawn.

- **`src/main/daemonConnection.test.ts`** — a new `rate_limited` describe block beside the
  `thinking_progress` one, with a `rateLimitedPlaintext` helper cloned from
  `thinkingProgressPlaintext` and a fixture built from the daemon's one measured non-benign capture
  (`allowed_warning` / `seven_day`):
  - a decoded frame emits exactly one `rateLimited` event, asserted with a strict `toEqual` on the
    whole event (the AC1/AC2 round trip; positive, so it also pins the absence of `daemonTs`).
  - `Object.keys(...).sort()` on a frame carrying a smuggled extra key — one assertion proving three
    things at once: `truncated_fields` does not cross, the snake spellings do not cross, and the emit
    is a named copy rather than a spread. Paired with a negative on the truncation marker's own value.
  - the open sets survive the crossing: an unrecognised `status`, an unrecognised `limit_type` and the
    empty string for each all emit unchanged. These are the assertions that redden if someone later
    narrows either field on this boundary.
  - `resetsAt` crosses at `0` (the did-not-report reading, the truthiness trap the wire's missing
    `omitempty` creates), at a negative value and at an absurd magnitude — the range the emit must not
    police.
  - **no dedup:** two identical frames emit two events, and a status change followed by a verbatim
    repeat emits all three in wire order.
  - a malformed frame (a JSON-string `resets_at`) emits nothing and does not throw.
- **The four bridge specs** — `daemonEventBridge.test.ts`, `modalBridge.test.ts`,
  `questionBridge.test.ts`, `timelineBridge.test.ts` each gain a `rateLimited` → `null` assertion in
  the shape each file already uses for `thinkingProgress` (an inline literal in the inverse-filter
  table for three of them; a named `it` for `daemonEventBridge`). `questionBridge`'s arm-count pin
  moves 42 → 43. `timelineBridge`'s adds the store-identity half its `thinkingProgress` test used
  (`store.getState()` is the same ref, and no item was appended), which is what makes AC3 an assertion
  rather than a claim.

Fakes, not mocks, throughout: the existing driver fake feeds plaintext, the existing `fakeBridge`
feeds the bridges.

## Open questions

- Which store #1320 claims the arm into — a dedicated store plus a fifth independent subscriber (the
  #850 / #974 shape) or an existing one. Recorded as DORMANT on `timelineBridge` rather than decided;
  the disposition comment says #1320 owns the choice, so either outcome falsifies no claim here.

## Revisions

**2026-09-08, during implementation — one test added beyond the plan's Testing strategy.** AC2 says
the emit "logs no decoded field on any path", and the plan discharged that structurally (this leg adds
no log call; #1318's decode-side record is pinned content-free separately). That left the AC's
end-to-end claim unasserted, so `daemonConnection.test.ts` gained a log-absence test: a frame carrying
distinctive values for all four crossing fields, asserted absent from every captured diagnostic
record, with a non-vacuity assertion that the frame nonetheless produced its `inbound-decoded` record
under the client-owned `code` literal. The local `connected()` helper takes an optional
`DiagnosticLog` to support it. No design change — an assertion the plan should have listed.

The plan's one Open Question (which store #1320 claims the arm into) is left open by design; nothing
in the implementation decided it, and `timelineBridge`'s no-op is recorded DORMANT accordingly.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings on the boundary itself. This slice crosses already-narrowed
  values over an existing boundary and adds no new one; the untrusted→trusted narrowing happened at
  `parseRateLimitedPayload` in #1318. The standing rule binds and is worth restating because the type
  system carries no signal for it: **decoding made the SHAPE trusted, not the CONTENT.** `status` and
  `limitType` are claude-authored text that crossed the subprocess trust boundary — the daemon bounds
  them but does not sanitize them — and `conversationId` is a daemon-asserted routing key whose
  membership in a known-conversation set is *not* checked here (the `modal_shown` scoping posture,
  #870). The renderer is untrusted relative to the main process, but the traffic direction is
  main→renderer over the existing `DAEMON_EVENT_CHANNEL`; no new renderer→main surface is opened.
- **[Trust boundaries]** MUST FIX **in the plan text, found and fixed before this commit**: the first
  draft of the arm's docblock inherited `RateLimitedPayload`'s "never used as a Map key, a lookup path
  or a filename" verbatim while AC4 requires the two strings be usable **as lookup keys for
  client-owned copy** — an inherited field contract that is false in the new consumer, which is a
  measured trap on this repo. Resolved in § Design under *Two divergences*, not papered over: the
  wire's prohibition is about a key that resolves a **resource** (filename, path, icon URL, cache
  entry); a key into a client-owned copy table selects among client-owned strings, falls back to
  generic wording on a miss, and is prototype-safe when the table is a `Map` (or an
  `Object.hasOwn`-guarded record). The arm's docblock carries both halves so the tightened-render /
  loosened-lookup split is explicit rather than a silent contradiction of the layer below.
- **[Trust boundaries]** SHOULD FIX, binding on #1320/#1321 and recorded so it stays findable: the
  consumer must render **client-owned copy selected by** `status` / `limitType`, never the strings
  themselves, and must have a generic fallback for an unmatched key — which is also what makes the
  dropped `truncated_fields` harmless, since a cut value misses the lookup exactly as an unknown one
  does. Nothing on THIS leg renders anything: the values are copied into a literal and handed to
  `emitDaemonEvent`, and all four bridges discard the event.
- **[Tokens, secrets, credentials]** Not applicable, structurally. No field is a credential, a nonce
  or a correlation secret — the contrast is `question_shown`'s `question_batch_id`, an unguessable
  one-time nonce, and there is no analogue here. The no-log rule below therefore rests on
  correlation-leak and content-leak grounds only, never on secrecy.
- **[File / storage operations]** Not applicable, and worth stating rather than skipping because
  `limitType` (`five_hour`, `seven_day`) is exactly the shape of short token that invites an
  icon-filename or a cache-key lookup. Nothing here touches the filesystem and no field is resolved
  into a path; `conversationId` in particular is never joined into one — the standing CLAUDE.md rule,
  untested by this slice because no code on this leg has a path to join it into. Nothing is persisted.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` API
  and no `ipcMain` handler is added — the arm rides the existing `DAEMON_EVENT_CHANNEL` through
  `emitDaemonEvent`, whose sink discipline (`isDestroyed` read inside `send`) is untouched.
  `webPreferences` is not touched. The event is a structured-clone-safe literal of three strings and
  one number: no function, no `Buffer`, no key and no raw frame can ride it, and its whole surface is
  enumerated by the exact-keys assertion in the test plan. Process placement is unchanged and correct:
  the socket, the Noise session and the keys stay in the background process.
- **[Cryptographic primitives]** Not applicable — no key, nonce, handshake, RNG or comparison is added
  or re-derived. The BLAKE2s digest on the decode path is #1318's and is untouched.
- **[Network & I/O]** No findings, and the sharpest inherited obligation discharged rather than
  forwarded blindly. #1318 recorded a SHOULD FIX: `resetsAt` is an unvalidated, daemon-supplied,
  claude-authored number, and the obvious consumer move —
  `setTimeout(cb, resetsAt * 1000 - Date.now())` — turns a hostile or merely wrong value into either a
  negative delay that fires immediately (a spin loop if the handler re-arms) or a value past
  `setTimeout`'s ~24.8-day 32-bit clamp, which also fires **immediately** rather than never. **This
  leg schedules nothing**: the value is copied into a literal and handed to an existing sink, and the
  arm's docblock carries the prohibition forward to #1321 in the `attachment_chunk` "never allocate
  from a claim" wording. The frame-level `MAX_PLAINTEXT_BYTES` bound in `parseInboundMessage` remains
  the size limit and no second one is invented. A hostile daemon **can** flood this frame; the
  tempting defence (a rate limit, a coalescing timer, a last-value memo) is **rejected on purpose** —
  it would be the only mutable state on this path, keyed by a daemon-supplied id and fed by a
  daemon-supplied stream, and the daemon re-reports the window once per run whatever its state, so a
  suppressor would eat the report that says the reading is current. The flood's blast radius is one
  small literal per frame handed to an existing sink; AC2 pins the refusal with a test.
- **[Error messages, logs, telemetry]** No findings. `emitDaemonEvent` is log-free by construction and
  #1318's decode-side log line is content-free and independently pinned, so nothing decoded reaches a
  log on any path. Each field is something a content-free log has no business carrying: the id is
  conversation-correlating in a bundle an operator may send off-box; `status` and `limitType` are
  unsanitized model-influenced text in a file whose readers assume it is machine-written; and the pair
  together discloses **the account's quota posture**, a fact about the operator rather than about this
  frame. No error message is minted here and none interpolates a value. The one route by which any of
  it could still land in an `Error` message, a stack trace and a crash reporter is a **missing bridge
  case** — `assertNever` stringifies the whole event — which is exactly why all four cases land in
  this commit rather than any subset.
- **[Concurrency]** Not applicable, stated rather than assumed: one union member, one synchronous
  `switch` case, four `return null` cases. No task, no timer, no listener, no shared mutable state, no
  `await` — nothing to cancel, nothing to tear down, no check-then-act race.
- **[Threat model alignment]** Addressed. *Hostile daemon response:* fail-closed upstream and
  unchanged — a malformed frame throws before the emit is reached and leaves no record, and the
  fresh-literal emit blocks a planted `__proto__` from riding across even if a future decoder let one
  through. A hostile daemon's remaining power is arbitrary `status` / `limitType` text, which is *by
  design*: the frame is a **report, never a control input**, nothing in the daemon keys behaviour on
  it, and this client must hold the same line — a client **MUST NOT branch security-relevant
  behaviour on `status`**, which the arm's docblock states. *Malicious relay:* on-path but
  content-blind; it can drop, delay, reorder or duplicate, and this arm carries no state transition,
  so a dropped frame loses a reading and a duplicate repeats a harmless one. That is why "absence
  proves nothing" is a security property here and not only a UX note. *Renderer compromise reaching
  the transport:* unchanged — no new renderer-reachable surface, and the arm is one-directional.
  *Prototype pollution:* the id is never a `Record` key on this leg, and `conversationRouter`'s index
  — the one place a `conversationId` becomes a key in the main process — is a `Map` and does not read
  this arm.
- **[Threat model alignment]** OUT OF SCOPE, named rather than silently deferred, all three for
  #1320/#1321: the wording problem the daemon names (an `allowed_warning` frame must not be rendered
  as "you are blocked"); whether a consumer may attribute a reading to a conversation it does not
  host, deferred forward one hop again with its reason restated because all four translators still
  discard the event; and any range-checked *formatting* of `resetsAt` as a date, which needs the
  surface that displays it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
