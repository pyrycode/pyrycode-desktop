# #1313 — carry the thinking-token estimate across to the window

The second step for `thinking_progress`: #1312 decoded the frame into an inbound arm that stops in the
background process; this slice emits it as a `DaemonEvent` so renderer state can hold it. The same
carry step `question_shown` took at #885 and `modal_shown` at #871.

## Files read

- `src/shared/wire/types.ts` → `ThinkingProgressPayload` — the three wire fields and the contract
  clauses (no `omitempty`, so a zero reading is legal traffic; the deltas received do not sum to the
  turn's total; `estimated_tokens` restarts near zero at every inference-request boundary).
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`'s `thinking-progress` arm,
  `parseThinkingProgressPayload` — what #1312 produced, and why it takes no `FrameTimestamp`.
- `src/main/daemonConnection.ts` → the inbound switch's `model-announced` case — the shape precedent
  for the emit (fresh literal, fields by name, no `daemonTs`), and `api-retry` / `compacting` beside
  it for the by-name-never-spread rule and the "no dedup on this leg" argument.
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent` — the log-free sink the emit goes through.
- `src/shared/ipc/events.ts` → `BaseDaemonEvent`, its `modelAnnounced` arm, `DaemonEventTimestamp` /
  `WithDaemonTs` — where the new arm lands and why it carries no `daemonTs`.
- `src/main/conversationRouter.ts` → `record` — reads only `conversationsReceived` and
  `conversationCreated`, so a new arm carrying `conversationId` feeds no index. Load-bearing for AC3.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`;
  `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`;
  `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`;
  `src/renderer/src/store/questionBridge.ts` → `translateQuestionEvent` — the four `DaemonEvent`
  switches ending in `assertNever`, derived by grep rather than from any comment naming them.
- `src/main/daemonConnection.test.ts` → the `model_announced` describe block and
  `modelAnnouncedPlaintext` — the round-trip test shape this slice clones.
- `docs/knowledge/features/daemon-event-channel-sealed-union.md` — the union's two standing rules: a
  member reuses its wire payload type where one exists, and `DaemonEvent` / `SessionAction` stay
  separately declared per layer. Neither is disturbed here (this arm carries scalars, not the payload
  type, because one of the three wire fields deliberately does not cross).
- `docs/specs/architecture/1312-thinking-progress-decode.md` § Security review — the two obligations
  #1312 handed forward to this slice, discharged under § Security review below.

## Design source

**Figma:** N/A — this slice adds no rendered surface. Nothing in the window draws the estimate after
it lands; the render slice is #1314.

## Context

The daemon's `thinking_progress` frame is claude's only mid-turn proof of life on the stream-json
surface. #1312 narrowed it into `InboundDaemonMessage`'s `thinking-progress` arm, where it stops:
`daemonConnection`'s inbound switch has no catch-all, so an unclaimed kind is dropped. This slice
claims it and emits a `DaemonEvent`, leaving the value where a renderer store can reach it.

**Sizing — six production files, one over the ceiling, stated rather than split.** The arm on
`BaseDaemonEvent` compile-forces a case in each of the four `assertNever`-closed bridges, so the
minimum landable change is `events.ts` + `daemonConnection.ts` + four bridges. The only cut that
divides it — arm plus four bridge no-ops first, emit second — produces a first slice whose one
deliverable (a union arm nothing emits) is consumed by exactly one sibling in the same family. That
is the floor rule, and the floor beats the ceiling: merged back, overage recorded here, built as one
ticket. Every other boundary holds — no new exported type (one arm on an existing union), five
consumer edits, three acceptance criteria, no new reject branch.

No ADR is warranted: this arm settles nothing the union's existing rules do not already decide.

## Design

**The arm.** Appended to the end of `BaseDaemonEvent`, where the union has grown since #1249:

```ts
| { type: 'thinkingProgress'; estimatedTokens: number; conversationId: string }
```

Two of the wire's three fields, snake→camel per the union's standing convention.

- `estimated_tokens_delta` **does not cross.** Nothing consumes it — #1314 shows the total alone —
  and the payload's own contract says the deltas received do not sum to the turn's total, so no
  consumer may accumulate them. A field crosses when something needs it.
- **No `daemonTs`.** #1312's decode arm deliberately takes no `FrameTimestamp`: `daemonTs` marks the
  arms `decodeHistoryEvent` draws, which need (`type`, `ts`) as the join key between a served page
  and the live stream, and a stored `thinking_progress` is still skipped, so there is no page half to
  join against. `modelAnnounced`, not `apiRetry`, is the precedent for the emitted literal's shape.
- `conversationId` is **required**, never optional — an optional routing key invites
  `?? activeConversation` fallbacks, the misattribution the per-conversation work exists to remove.

**The emit.** A `case 'thinking-progress':` in `daemonConnection`'s inbound switch, placed directly
after `model-announced` so the switch mirrors `InboundDaemonMessage`'s own arm order. It builds a
fresh three-property literal with each field copied **by name** from
`inbound.thinkingProgress` — never a spread of the decoded record, so a decoder that later grows a
field cannot smuggle it across IPC. That switch has no `assertNever`, so nothing compile-forces this
case; the round-trip test is what guards it.

**Statelessness is the contract, not an omission.** No dedup, no coalescing, no timer, no last-value
memo, and none keyed by `conversationId` either. The wire re-fires as the count climbs, and
`estimated_tokens` restarts near zero at every inference-request boundary — four times inside the
daemon's own single-turn capture — so a monotonic filter or a same-value suppressor here would
invent wire semantics the daemon does not have and would starve #1314 of readings it must draw.

**The four bridges.** Each ends its `DaemonEvent` switch in `assertNever`, so each needs a case or
`npm run typecheck` reddens; all four land in this commit.

| Bridge | Disposition |
|---|---|
| `translateDaemonEvent` (`daemonEventBridge.ts`) | PERMANENT no-op — the session store holds no thinking state, and #1314's consumer is elsewhere. Own case, appended before `default`. |
| `translateTimelineEvent` (`timelineBridge.ts`) | DORMANT — #1314 replaces it with a real mapping. Joins the existing null fall-through group. |
| `translateModalEvent` (`modalBridge.ts`) | PERMANENT no-op — nothing is waiting on an answer. Joins the null group. |
| `translateQuestionEvent` (`questionBridge.ts`) | PERMANENT no-op — a reading is not an ask. Joins the null group. |

The bridge set is derived by grep for an `assertNever` closing a `DaemonEvent` switch. Three comments
elsewhere (`systemPromptBridge`, `slashCommandListBridge`, `modelListBridge`) name a
`routeDaemonEvent` that exists nowhere and a `timelineWriteTarget` that switches over `ThreadEvent`
and needs no case; those comments are left exactly as they are, and neither name is copied into a new
one.

**No store is written differently than before this slice** (AC3). Each of the four translators
returns `null`, and `conversationRouter`'s `record` learns only from `conversationsReceived` and
`conversationCreated`, so the new arm's `conversationId` reaches no index either.

## State + concurrency model

None added. The change is one union member, one synchronous `switch` case that calls the existing
`emitDaemonEvent`, and four `return null` cases. No task is launched, no timer set, no listener
registered, no store slice created — so there is nothing to cancel, nothing to tear down on window
close, and no check-then-act window across an `await`.

## Error handling

Inherited, unchanged. `parseThinkingProgressPayload` is fail-closed upstream: a missing or mistyped
field throws `WireDecodeError`, which `parseInboundMessage`'s caller already catches and drops
without emitting — so a malformed frame produces no event and no throw, and the emit is reached only
with an already-validated payload. This slice adds no new failure mode and no new error surface: the
emit cannot fail, and the four bridges return `null` rather than throwing.

## Testing strategy

Vitest only (node environment). No renderer render and no Playwright spec: nothing is drawn.

- **`src/main/daemonConnection.test.ts`** — a new `thinking_progress` describe block beside the
  `model_announced` one, with a `thinkingProgressPlaintext` helper cloned from
  `modelAnnouncedPlaintext`:
  - a decoded frame emits exactly one `thinkingProgress` event, asserted with a strict `toEqual` on
    the whole event (the AC1 round trip; positive assertion, so it also pins the absence of
    `daemonTs`).
  - `Object.keys(...).sort()` equals `['conversationId', 'estimatedTokens', 'type']` on a frame
    carrying a smuggled extra key — one assertion proving three things at once: the delta does not
    cross, the snake spellings do not cross, and the emit is a named copy rather than a spread.
  - a frame whose two readings are `0` crosses `estimatedTokens: 0` — the truthiness trap the wire's
    missing `omitempty` creates.
  - **no dedup:** two identical frames emit two events, and a climb-then-restart sequence
    (`120 → 240 → 15`) emits all three in wire order. The restart case is the one a monotonic
    "optimisation" would eat, so it is the AC2 pin rather than a decoration on it.
  - a malformed frame (a JSON-string reading) emits nothing and does not throw.
- **The four bridge specs** — `daemonEventBridge.test.ts`, `timelineBridge.test.ts`,
  `modalBridge.test.ts`, `questionBridge.test.ts` each gain a `thinkingProgress` → `null` assertion
  in the shape each file already uses for `modelAnnounced` (an inline literal in the pass-through
  table for three of them; a named `it` for `daemonEventBridge`). `timelineBridge`'s adds the
  store-identity half its `modelAnnounced` test uses (`store.getState()` is the same ref, and no item
  was appended), which is what makes AC3 an assertion rather than a claim.

Fakes, not mocks, throughout: the existing driver fake feeds plaintext, the existing `fakeBridge`
feeds the bridges.

## Open questions

- Whether `timelineBridge` is where #1314 actually claims the arm, or whether it stands up a fifth
  independent subscriber the way #850 and #974 did. Recorded as DORMANT here rather than decided —
  the disposition comment says #1314 owns the choice, so a fifth-subscriber outcome falsifies no
  claim in this commit.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This slice crosses an already-narrowed value over an existing
  boundary and adds no new one. The untrusted→trusted narrowing happened at
  `parseThinkingProgressPayload` in #1312; what crosses here is a `number` and a `string` whose types
  are already proven. The standing rule still binds and is worth restating because the type system
  carries no signal for it: **decoding made the SHAPE trusted, not the CONTENT** — `estimatedTokens`
  is a daemon-asserted claim about how much claude thought, not a measurement this client made, and
  `conversationId` is a daemon-asserted routing key whose membership in a known-conversation set is
  *not* checked here (the `modal_shown` scoping posture, #870). The renderer is untrusted relative to
  the main process, but the traffic direction is main→renderer over the existing
  `DAEMON_EVENT_CHANNEL`; no new renderer→main surface is opened.
- **[Trust boundaries]** SHOULD FIX, inherited from #1312 and recorded so it stays findable: a
  consumer that renders `estimatedTokens` must not size an allocation, index a buffer, bound a loop,
  or otherwise iterate proportionally to it — it is an unbounded daemon-supplied integer, and the
  neighbour that sank on exactly this is `attachment_chunk`'s `total_chunks` ("never allocate from a
  claim"). Nothing on THIS leg does any of those: the value is copied into a literal and handed to
  `emitDaemonEvent`, and all four bridges discard it. The obligation binds #1314.
- **[Tokens, secrets, credentials]** Not applicable, structurally. Neither field is a credential, a
  nonce or a correlation secret. The contrast worth naming is `question_shown`, whose
  `question_batch_id` is an unguessable one-time nonce — there is no analogous field here, so the
  no-log rule below rests on correlation-leak and side-channel grounds only, never on secrecy.
- **[File / storage operations]** Not applicable. Nothing here touches the filesystem, and no field
  is resolved into a path, a filename or a cache key. `conversationId` in particular is never joined
  into a path — the standing CLAUDE.md rule, untested by this slice because no code on this leg has a
  path to join it into. Nothing is persisted, so token-theft-from-disk does not arise.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` API
  and no `ipcMain` handler is added — the arm rides the existing `DAEMON_EVENT_CHANNEL` through
  `emitDaemonEvent`, whose sink discipline (`isDestroyed` read inside `send`) is untouched. The event
  is a structured-clone-safe literal of one string and one number: no function, no `Buffer`, no key
  and no raw frame can ride it, and its whole surface is enumerated by the exact-keys assertion in
  the test plan. `webPreferences` is not touched. Process placement is unchanged and correct: the
  socket, the Noise session and the keys stay in the background process; what crosses is two scalars.
- **[Cryptographic primitives]** Not applicable — no key, nonce, handshake, RNG or comparison is
  added, and none is re-derived. The BLAKE2s digest on the decode path is #1312's and is untouched.
- **[Network & I/O]** No findings, and one specific trap refused rather than merely avoided. The
  frame-level `MAX_PLAINTEXT_BYTES` bound in `parseInboundMessage` is the size limit and this slice
  invents no second one. A hostile or confused daemon **can** flood `thinking_progress`, and the
  tempting defence — a rate limit, a coalescing timer, or a last-value memo on this leg — is
  **rejected on purpose**: it would be the only mutable state on this path, keyed by a
  daemon-supplied id and fed by a daemon-supplied stream, and it would silently eat the legitimate
  restart-near-zero sequence the wire guarantees. The flood's blast radius is bounded by what the
  emit does, which is allocate one small literal per frame and hand it to an existing sink; the
  ordering fix, if one is ever needed, belongs in the renderer's render loop where a dropped frame
  costs nothing, not in the transport where it costs a reading. AC2 pins the refusal with a test.
- **[Error messages, logs, telemetry]** No findings. `emitDaemonEvent` is log-free by construction,
  and #1312's decode-side log line is content-free and independently pinned — so neither the id nor
  the reading reaches a log on any path. Both are things a content-free log has no business carrying:
  the id is conversation-correlating in a bundle an operator may send off-box, and the reading is a
  **side-channel on how much claude thought** about private work. No error message is minted here and
  none interpolates a value. The one route by which either could still land in an `Error` message, a
  stack trace and a crash reporter is a **missing bridge case** — `assertNever` stringifies the whole
  event — which is exactly why all four cases land in this commit rather than any subset.
- **[Concurrency]** Not applicable, stated rather than assumed: one union member, one synchronous
  `switch` case, four `return null` cases. No task, no timer, no listener, no shared mutable state,
  no `await` — so nothing to cancel, nothing to tear down, and no check-then-act race.
- **[Threat model alignment]** Addressed. *Hostile daemon response:* fail-closed upstream and
  unchanged — a malformed frame throws before the emit is reached and leaves no record, and the
  fresh-literal emit blocks a planted `__proto__` from riding across even if a future decoder let one
  through. *Malicious relay:* on-path but content-blind; it can drop, delay, reorder or duplicate,
  and this arm carries no state transition, so a dropped frame loses a reading and a duplicate
  repeats a harmless one. That is why "absence proves nothing" is a security property here and not
  only a UX note: nothing may infer a stall from a gap. *Renderer compromise reaching the transport:*
  unchanged — no new renderer-reachable surface, and the arm is one-directional. *Prototype
  pollution:* the id is never a `Record` key on this leg, and `conversationRouter`'s index — the one
  place a `conversationId` becomes a key in the main process — is a `Map` and does not read this arm.
- **[Threat model alignment]** OUT OF SCOPE, named rather than silently deferred: whether a consumer
  may attribute a reading to a conversation it does not host is **#1314's**, the first slice with a
  surface to misattribute on. #1312 deferred it here; there is still nothing on this leg to defend,
  because all four translators discard the event, so it moves forward one hop with its reason
  restated rather than being closed by assertion.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
