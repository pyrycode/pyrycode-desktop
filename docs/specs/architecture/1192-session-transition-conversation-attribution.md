# #1192 — attribute an unsolicited `session_transition` to the conversation it names

An unsolicited `session_transition` marker currently writes its `new_session_id` into the
app-singleton `sessionIdStore` for whatever conversation is open when it lands. This ticket brings
the ported wire payload into line with the daemon — which has carried `conversation_id` on this
payload since upstream #740/#741 — carries that routing key across IPC, and gates the renderer's
write on it with the same one-line early return #1176 shipped for the reply-only ingress.

## Files read

Production:

- `src/renderer/src/store/sessionIdBridge.ts` → `translateSessionTransition`, `subscribeSessionId`,
  `SessionIdData` — the defective ingress, and the module this ticket changes behaviourally.
  Its container docblock's "the id must be retained regardless of which screen is shown" is the
  sentence this ticket un-says.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `subscribeRunConfig` — the shipped
  #1176 gate whose shape this copies verbatim (one early return, before the pure translators).
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `RunConfigLiveData` — the wiring:
  `() => activeConversationStore.getState().activeConversation?.id ?? null`, read non-reactively at
  call time. Also records the `selectOpenConversationId` extraction signal this ticket leaves alone.
- `src/shared/wire/types.ts` → `SessionTransitionPayload`, `WireSessionTransitionReason` — the stale
  port. Its docblock asserts "**There is NO `conversation_id`**", which the daemon falsifies.
- `src/main/transport/inboundMessage.ts` → `parseSessionTransitionPayload`, and
  `parseUnrecognizedMessagePayload` beside it as the in-repo precedent for a **required**
  `requireString(payload, 'conversation_id')` on an inbound payload.
- `src/main/daemonConnection.ts` → the `case 'session-transition'` emit arm, and the `case 'message'`
  `parseInboundMessage` try/catch above it — the catch is what makes AC1's "dropped at the decode,
  emitting no event and leaving the connection up" already true for any `WireDecodeError`.
- `src/shared/ipc/events.ts` → the `sessionTransition` arm, and the `unrecognizedMessage` arm whose
  docblock states why a routing key on this union is REQUIRED, never optional ("an optional routing
  key invites the `?? activeConversation` fallback #675 exists to remove").
- `src/main/correlationRouter.ts` → the `case 'sessionTransition'` arm feeding `learn(sessions, …)`.
  Its header is the reason main keeps forwarding every marker; gating in main would blind this index.
- `src/renderer/src/store/timelineBridge.ts` → `conversationIdOf`, `timelineWriteTarget` — the
  deliberately-unchanged consumer, and the loudest "carries no conversation id and never will"
  comment site.
- `src/renderer/src/App.tsx` → the `<SessionIdData />` mount and the `timelineWriteTarget` injection
  comment, which repeats the same falsified claim.

Tests and drives:

- `src/renderer/src/store/sessionIdBridge.test.ts` → the `fakeBridge` spy idiom the new gate tests
  extend; its "writes an empty-string newSessionId" case is AC3's verbatim-hold pin.
- `src/shared/wire/types.test.ts` → the `session-transition wire vocabulary (#254)` describe; its
  shape test names "no conversation_id" **in the test name** and reddens by name.
- `e2e/run-config-cross-conversation.spec.ts` → #1176's drive: the second-chat-via-FAB shape, the
  captured-and-unanswered request trick, and the ordered-transport barrier. The new drive is its
  sibling and copies its structure.
- `e2e/composer-effort-menu.spec.ts` → `capturingFake`, `settingsFramesMatching`, and the
  `.composer__effort-label` / `getByRole('menu', { name: 'Effort' })` interaction the new drive uses
  to make the held session id operator-visible.

Knowledge:

- `docs/knowledge/features/session-id-store.md` § Edge cases — "A late `sessionTransition` for the
  previous conversation can re-stale the id after a switch" already names this exact defect and
  concludes "Not fixable at this store's layer; needs a daemon-side conversation-id tag or
  main-process suppression." The first disjunct is what shipped upstream; this ticket consumes it.
  The overview's "the marker carries no `conversation_id`" claims (two sites) go stale with this
  change — **documentation phase owns them**, not this ticket.
- `docs/knowledge/features/run-config-store.md` § Conversation-attributed since #1176 — states the
  gate must call `getOpenConversationId` **per event, never captured once at subscription**, which
  is AC4, and names #1192 as the one ingress #1176 cannot reach.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and none is owed. This ticket adds no visual
surface: it changes a wire type, a decoder, an IPC field, and one early return in a headless
renderer leaf that renders `null`. The e2e drive reads existing chrome only.

## Context

`sessionIdStore` has two ingresses. #1176 closed the misattribution on the reply-only one
(`runConfigReceived`) by correlating client-side against the envelope id of the
`request_session_settings` that named the conversation. That mechanism is unavailable here: a
`session_transition` is **pushed unsolicited**, so there is no outbound request to correlate against.

The premise the ticket was originally filed on — that the routing key would need a wire change and
therefore an upstream ticket — is false and the ticket body records the verification: the daemon's
`SessionTransitionPayload` has carried `ConversationID` as its first field since upstream #740
(merged `648afb4a`), and `broadcast` in `cmd/pyry/session_transition_v2.go` resolves and stamps it
per transition, **dropping the whole event** rather than emitting an unresolvable one (upstream
#741). So the field is on the wire, always present, and never empty on a conforming daemon. Under
CLAUDE.md's wire rule the half that is out of step is this repo's port, and bringing it into line is
this ticket.

`docs/specs/architecture/1176-late-session-settings-attribution.md` records the opposite,
blocked-on-the-daemon conclusion. It is a merged spec doc and it is wrong on this point.

**No ADR is owed.** ADR 0002 already governs the port-matches-mobile rule this change obeys; nothing
here establishes a new decision. The documentation phase should fold the change into
`session-id-store.md` (whose § Edge cases entry is now resolved) and `daemon-event-channel-*`.

### Declared size overage, on the floor-beats-ceiling rule

Two lines of the size-S table are exceeded, both deliberately and both inherited from the refiner's
own declared overage:

- **Consumer call sites (≤ 10):** roughly 35. Adding a *required* field to `SessionTransitionPayload`
  and to the `sessionTransition` arm of `DaemonEvent` makes every literal of either a compile error.
  `tsc` enumerates all of them; each is a one-line addition.
- **Production source files (≤ 5):** eight. Five carry behaviour —
  `src/shared/wire/types.ts`, `src/main/transport/inboundMessage.ts`, `src/main/daemonConnection.ts`,
  `src/shared/ipc/events.ts`, `src/renderer/src/store/sessionIdBridge.ts`. Three
  (`src/renderer/src/store/timelineBridge.ts`, `src/renderer/src/App.tsx`, plus the docblocks in the
  behavioural five) are **comment-only** corrections of claims this ticket falsifies.

The seam a split would use is (a) wire type + decoder, (b) IPC field + gate. It is rejected on the
floor rule: (a)'s only consumer is (b), inside the same family, so it is part of (b) rather than a
ticket of its own — and AC1 states the crossing as one deliverable ("the marker's conversation id
crosses the transport"). A required field on a discriminated-union arm also cannot be added without
its literals moving in the same commit, so neither half compiles alone. Depth checked: #1192 has no
parent and no grandparent, so a split is permitted by depth and rejected on merit.

## Design

### 1. The wire port — `src/shared/wire/types.ts`

`SessionTransitionPayload` gains `conversation_id: string` as its **first** field, mirroring the
daemon's field order (`ConversationID` first, `json:"conversation_id"`, no `omitempty`). Six fields,
all required, `workspace_cwd` still the one nullable.

The docblock's "**There is NO `conversation_id`** — a session boundary is attributed by the
connection it arrives on" is replaced by the current contract: the daemon resolves the owning
conversation from `NewSessionID` once per transition and drops the event when it cannot, so a
conforming daemon never sends this payload without a non-empty routing key.

### 2. The decoder — `src/main/transport/inboundMessage.ts`

`parseSessionTransitionPayload` gains one line,
`const conversation_id = requireString(payload, 'conversation_id')`, and returns a fresh six-field
literal. Fail-closed by construction, the same shape `parseUnrecognizedMessagePayload` already uses
for its own `conversation_id`.

AC1's "dropped at the decode, emitting no event and leaving the connection up" needs no new code:
`requireString` throws `WireDecodeError`, and `daemonConnection`'s `case 'message'` already catches
it, returns without emitting, and drops the caught error rather than logging it. The behaviour is
inherited; the **test** for it is new.

No length check, no charset check, no allow-list on the id — matching every sibling
`conversation_id` in this decoder. `parseInboundMessage`'s frame-level `MAX_PLAINTEXT_BYTES` guard is
the bound, and a second one here would defend a failure that cannot reach the line.

### 3. The IPC event — `src/shared/ipc/events.ts`

The `sessionTransition` arm gains `conversationId: string`, **required**, for the reason the
`unrecognizedMessage` arm's docblock already states: an optional routing key invites the
`?? activeConversation` fallback the #675 family exists to remove. snake→camel per this union's
convention. The docblock gains the field's provenance — daemon-asserted, copied by name from an
already-validated payload — and the standing note that a routing id is not a secret.

### 4. The emit — `src/main/daemonConnection.ts`

`conversationId: inbound.sessionTransition.conversation_id`, copied **by name** into the existing
fresh literal (never a spread), joining the four fields already copied there. `previous_session_id`
stays dropped — still no consumer.

**Main keeps forwarding every marker.** `correlationRouter`'s `case 'sessionTransition'` arm learns
`newSessionId → serverId` off this event, and its header spells out why: after a rotation the store
addresses an id `runConfigReceived` has not reported yet, so every settings write in between would
refuse with no frame on any wire. Gating in the background process would blind that index and
reintroduce the bug it was written for. Only the renderer's session-id write is gated.

### 5. The gate — `src/renderer/src/store/sessionIdBridge.ts`

`subscribeSessionId` gains a fourth parameter and one early return, copied from `subscribeRunConfig`:

```ts
subscribeSessionId(onDaemonEvent, setSessionId, getOpenConversationId): () => void
// onDaemonEvent(event => {
//   if (event.type === 'sessionTransition' && event.conversationId !== getOpenConversationId()) return
//   const id = translateSessionTransition(event); if (id !== null) setSessionId(id)
// })
```

Four decisions, each mirroring the shipped gate rather than inventing:

- **The `event.type ===` conjunct is kept** even though `sessionTransition` is this filter's only
  owned arm. It is what narrows `event` so `event.conversationId` resolves with no cast, and keeping
  the identical shape is the "copy #1176's gate, do not invent one" instruction.
- **`translateSessionTransition` is untouched** — it stays a pure `DaemonEvent → string | null`
  mapper. Widening it to take the open id would give one decision two implementations, which is the
  reason `runConfigSnapshot` states for leaving its own translators alone.
- **The `id !== null` guard survives verbatim**, so AC3's empty-string hold is unchanged: a matching
  marker carrying `newSessionId: ''` still lands `''`.
- **No conversation open ⇒ nothing lands.** `getOpenConversationId()` returns `null`, no
  daemon-supplied `conversation_id` is `null`, so the comparison is unequal and the marker is
  dropped rather than latched. Fail-closed, and the same direction `runConfigLive`'s `?? null`
  spelling was chosen for.

`SessionIdData` passes
`() => activeConversationStore.getState().activeConversation?.id ?? null` as the third argument —
`RunConfigLiveData`'s wiring verbatim, read **non-reactively at call time inside the listener**, so
the leaf still subscribes to nothing and server-renders to `''` without a bridge mock. AC4 is
exactly this: an id captured in the closure would freeze at whatever was open when the app-level
leaf mounted, compile, and pass every single-event test.

The container docblock's "so the id must be retained regardless of which screen is shown" is
rewritten rather than touched up: the always-listening mount is still right (a marker can arrive
before any sheet exists) but retention is now conditional on the marker naming the open chat.

**`selectOpenConversationId` is NOT extracted here.** `runConfigLive.ts` records that a third
consumer of this getter is the signal for that selector, "a separate three-line ticket". This makes a
fourth. Extracting it would be adjacent refactoring; the signal stays where its author put it.

### 6. The comment sweep

The claim, not the identifier — several sites state the wire has no conversation id without naming
any symbol this ticket touches, and this repo hard-wraps at ~100 columns, so the sweep is a
multiline grep for the *claim*. Sites found and corrected: `types.ts` (the payload docblock),
`daemonConnection.ts` (the emit arm), `events.ts` (the `sessionTransition` arm),
`sessionIdBridge.ts` (module header + both function docblocks + the container),
`timelineBridge.ts` (`conversationIdOf`'s second group and `timelineWriteTarget`'s header — three
"carries no conversation id and never will" claims), `App.tsx` (the injection comment),
`timelineBridge.test.ts` (the precedence pin's "unreachable in production today"),
`types.test.ts` (a test *name*), and both e2e frame docblocks.

**`timelineBridge`'s behaviour is deliberately unchanged.** `conversationIdOf` keeps returning `null`
for the `sessionTransition` arm, so the session delimiter goes on rendering in the chat on screen.
Routing it by the new id is a second deliverable with its own detector. Its "never will" comments
become "does not read it, see #1192"; the precedence pin in `timelineBridge.test.ts` stops being
hypothetical and its comment says so.

## State + concurrency model

No new async work, no new subscription, no new store. The one listener `SessionIdData` already owns
keeps its app-lifetime `useEffect` with the `off` handle as its cleanup, so a StrictMode double-mount
still nets exactly one live listener.

The only concurrency-relevant change is *when* the open-conversation id is read: inside the listener,
per arriving event, never at subscribe time. `activeConversationStore.getState()` is a synchronous
non-reactive read with no `await` between the read and the store write, so there is no check-then-act
gap for a concurrent handler to widen — the whole listener body runs to completion in one task.

Ordering across the two `sessionIdStore` ingresses is unchanged: neither is preferred, arrival order
wins. The gate only removes writes that never belonged to the open chat.

## Error handling

- **Decode:** a `session_transition` frame missing `conversation_id`, or carrying a non-string one,
  throws `WireDecodeError` inside `parseSessionTransitionPayload`. `daemonConnection`'s existing
  `case 'message'` catch drops the frame — no event emitted, no throw, connection untouched — and
  drops the error object itself rather than logging it (classify-don't-forward: its message could
  echo plaintext). A conforming daemon cannot produce this frame; a non-conforming or hostile one
  loses only its own marker.
- **Renderer:** the gate is a pure comparison of two strings-or-null. It cannot throw, and the
  listener still only dispatches — it never throws into React.
- **No new log call.** ADR 0007's content-free rule and the existing arm's posture both hold: the
  decoder's messages name the failure *category* only (`missing required field: conversation_id`),
  never the id, and `emitDaemonEvent` is log-free by construction. A per-drop log here would be a
  defence against an unobserved failure and would put a conversation-correlating id near a sink.

## Testing strategy

Vitest (node environment, static server renders — no DOM, no effects, no clicks):

- `types.test.ts` — the shape test asserts six fields and `toHaveProperty('conversation_id')`; its
  name loses "no conversation_id". The `WireSessionTransitionReason` closed-set test is untouched.
- `inboundMessage.test.ts` — the four existing payload literals gain the field; two new cases: a
  full round trip carrying `conversation_id` through to the narrowed result, and a **missing
  `conversation_id` throws** case pinning the fail-closed decode (AC1).
- `daemonConnection.test.ts` — the six wire literals and the event literals gain the field; the
  round-trip emit test asserts `conversationId` crosses. A frame with no `conversation_id` emits no
  event and leaves the connection up (AC1's second half).
- `sessionIdBridge.test.ts` — the gate, called directly with spies:
  - a marker naming the open conversation writes its id (unchanged behaviour);
  - a marker naming a **different** conversation calls `setSessionId` zero times (AC2);
  - a marker arriving while `getOpenConversationId()` returns `null` writes nothing (AC3);
  - a matching marker carrying `newSessionId: ''` still writes `''` (AC3, the `!== null` guard);
  - **per-event resolution (AC4):** one subscription, a getter whose return value *changes between
    emits* — marker for A while A is open lands, then the getter flips to B, then a marker for B
    lands and a second marker for A does not. A closure-captured id passes the first assertion and
    fails this one, which is the whole point.
  - an unrelated event still no-ops; the off handle is still the cleanup.
- The seven other renderer/store test files carrying `type: 'sessionTransition'` literals get the
  one-line field addition; none of their assertions change.

Playwright, fake tier — `e2e/session-transition-cross-conversation.spec.ts`, the sibling of
#1176's `run-config-cross-conversation.spec.ts`:

A drive that skips the second chat asserts nothing — the fake tier's markers name the seeded
conversation, so they would have matched anyway. So: open the seeded chat A (the fixture's own
launch click), answer its `request_session_settings` so the footer's effort control is live and
`sessionIdStore` holds A's session, mint chat B with the FAB and answer B's request with a **second,
distinct** session id, then push a `session_transition` naming **A** while B is open. Barrier on an
ordered-transport frame whose effect is visible, then drive the effort menu in B and assert the
captured `set_session_settings` carries **B's** session id. Mutation check last: push a
`session_transition` naming **B**, drive the menu again, and assert the write now carries B's
*rotated* id — proving markers do land when they match and the drive is not asserting against a dead
pipeline. Seed names and session ids share no substring (Playwright's `hasText` is a
case-insensitive substring match).

Fakes over mocks throughout: `conversationStateFake` plus a capturing `buildReplyFrames`, no
`vi.mock` of the transport.

## Open questions

1. **Does `types.test.ts`'s `not.toHaveProperty('conversation_id')` assertion have a sibling
   elsewhere?** The multiline sweep found one at `types.test.ts:1575`, but it belongs to the
   *attachment* payload, which genuinely carries no conversation id. Confirm during implementation
   that no other `not.toHaveProperty` pins this payload. → resolve in Phase B; record here if the
   answer changes the sweep.
2. **Does any e2e spec beyond the two named push a `session_transition`?** The ticket names
   `thread-shadow` and `thread-scroll-pin`. Confirm by grep before the build, since a missed frame
   fails the decode silently and stops drawing its `.session-delimiter` rather than erroring.
3. **Barrier choice for the new drive.** #1176's drive used a `turn_state` `thinking` push (the Stop
   button). Confirm that is still the cheapest visible ordered-transport effect once a run-config
   snapshot exists for B, or pick another; a `running → idle` transition is a refresh edge and must
   be avoided, since the drive owns every request.

## Security review

**Verdict:** PASS

The load-bearing observation: this change **promotes a daemon-asserted string from inert to
control-relevant**. `conversation_id` on this payload previously did not exist in the port; after this
ticket it decides whether a session id enters the store that every `set_session_settings` addresses.
That promotion is what the categories below are walked against.

**Findings:**

- **[Trust boundaries]** No MUST FIX, one named hazard. The boundary is explicit and single:
  `parseSessionTransitionPayload` is the only place this field is narrowed from `unknown`, and
  everything downstream holds `SessionTransitionPayload` / the typed IPC arm. Downstream the id is
  **compared and discarded** — the gate is the only reader, it never stores, renders, or forwards it.
  SHOULD FIX for Phase B, stated because it is the way this design silently inverts: the gate is a
  **narrowing** filter and must stay one. A `===` where `!==` belongs, or an "if no conversation is
  open, accept" fallback, turns it into a widening one and reintroduces the defect while compiling
  and passing a single-event test. Both directions have a named test in § Testing strategy.
- **[Trust boundaries — the `''` edge]** No finding, recorded because it looks like one.
  `activeConversation?.id ?? null` coalesces only `undefined`/`null`, never `''`, so an open
  conversation whose id were `''` compares equal to a marker naming `''` — a *matching* pair, which is
  the semantically right answer, not a bypass. `null` (nothing open) matches no daemon-supplied id, so
  the no-open case fails closed.
- **[Tokens, secrets, credentials]** No findings. No token, key, or credential is created, read,
  stored, rotated, or revoked. A `session_id` is a routing id, not a secret — this repo's standing
  convention, restated on this very arm — and a `conversation_id` is the same class. Nothing reaches
  `safeStorage`, and no at-rest surface is added. The change strictly *reduces* the poisoning surface
  on the id that addresses `set_session_settings`.
- **[File / storage operations]** No findings, and one prohibition worth stating rather than
  assuming: the new id must never reach `path.join` / `path.resolve`, a filename, a cache key, or a
  lookup path. A daemon-supplied routing key concatenated into a path is the traversal shape. This
  design touches no `fs` call at all, writes nothing to disk, and builds no path.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new
  `contextBridge` API, no new `ipcMain.handle`/`on`, no `webPreferences` change. One field is added to
  an existing main → renderer event arm; **nothing new flows renderer → main**, which is the
  direction that carries privilege. Honest limitation, stated so it is not later mistaken for a
  defence: the gate lives in the **renderer**, so a compromised renderer bypasses it trivially — but
  such a renderer could already call `sessionIdStore.getState().setSessionId` directly. The gate is a
  **correctness control against misattribution, not a security boundary against a hostile renderer**,
  and no part of this plan may be read as claiming otherwise. Gating in main was rejected for a
  separate, documented reason (it would blind `correlationRouter`'s session→server index), not as a
  security judgement.
- **[Cryptographic primitives]** No findings, with the non-obvious half spelled out: the gate's `!==`
  is **not** a secret comparison, so `crypto.timingSafeEqual` is not owed here. Both operands are
  routing ids the renderer already holds in plain memory; there is no secret whose bits a timing
  channel could recover, and the comparison happens in the process that already has both values. No
  RNG, no key, no nonce, no AEAD framing is touched; the Noise variant constant is untouched.
- **[Network & I/O]** No findings. No socket, URL, timeout, TLS setting, or reconnect path changes.
  Frame bounding is unchanged — `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` still caps the whole
  payload, so the new field adds no unbounded string, and a per-field length check would defend a
  failure that cannot reach the line (the reasoning every sibling `conversation_id` in this decoder
  already carries). Accepted consequence, named rather than fixed: making the field **required**
  means a non-conforming daemon that stops sending it loses every session-boundary marker. That
  degradation is graceful and bounded — the connection stays up, all other frames keep flowing, and
  the second ingress (#1176's `runConfigReceived`, request-driven and asked on every activation since
  #1166) still supplies the session id. The alternative, an optional field with an
  open-conversation fallback, is exactly the `?? activeConversation` shape the #675 family exists to
  remove, and it would make the defect unfixable by design.
- **[Error messages, logs, telemetry]** No findings, one MUST-NOT for Phase B. The only new failure
  message is `requireString`'s static `missing required field: conversation_id`, which interpolates no
  value; the thrown `WireDecodeError` is caught and **dropped** at `daemonConnection`'s `case
  'message'` boundary (classify-don't-forward) and never reaches a log. **Do not add a "dropped a
  marker for another conversation" log call in the gate** — however useful it would look while
  debugging, it puts a conversation-correlating id into the renderer console, which anything that can
  open DevTools reads, and it would defend an unobserved failure. This plan adds no log call anywhere,
  deliberately, and ADR 0007's content-free rule is why.
- **[Concurrency]** No findings, one named regression scenario. The listener body is fully
  synchronous — `activeConversationStore.getState()` then a string compare then the store write, with
  no `await` in between — so there is no check-then-act gap a concurrent handler could widen. No new
  timer, no new `AbortController`, no new listener: the single app-lifetime subscription keeps the
  `off` handle as its effect cleanup, so a StrictMode double-mount still nets one live listener. The
  scenario to guard: hoisting `getOpenConversationId()` out of the listener "so it is read once" is a
  silent regression that compiles and passes every single-event test. That is AC4, and § Testing
  strategy pins it with a getter whose return value changes between emits.
- **[Threat model alignment]** Walked against the three desktop threats that apply.
  **Malicious / compromised relay** (content-blind but on-path): it can drop, delay, or reorder
  markers. Dropping leaves a stale id — already true today, recovered by the #1176 ingress plus
  #1166's ask-on-activation. *Delaying a marker across a conversation switch is precisely the defect
  this ticket closes*, so this change improves the hostile-relay posture rather than merely holding
  it. **Hostile / compromised daemon inside the session**: it can still forge a marker naming the
  conversation that is actually open and steer the operator's next settings write to a session id of
  its choosing. Not closed, and not closeable at this layer — the daemon is the authority on session
  ids by construction — but strictly *narrower* than today, where any marker lands unconditionally
  regardless of which chat it names. Pre-existing trust assumption, not a regression introduced here.
  **Renderer compromise reaching the transport**: unaffected; no key, socket, or raw byte crosses, and
  process placement is unchanged.
- **[Out of scope, named with its owner]** `timelineBridge`'s `conversationIdOf` keeps returning
  `null` for this arm, so a session delimiter still renders in the chat on screen rather than the one
  the marker names. That is a *display* misattribution with its own detector, deliberately deferred by
  this ticket's Technical Notes; it carries no write and addresses no session, so it is not a security
  finding. Owner: a future ticket, not filed here — the refiner is the one who sizes it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
