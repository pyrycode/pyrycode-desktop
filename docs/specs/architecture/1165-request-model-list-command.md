# #1165 — The app can ask the daemon for a conversation's model list

The outbound half of `request_model_list`: a renderer command naming one conversation becomes one
encrypted `request_model_list` envelope on the connection that hosts that conversation. Declaration
(wire type + `EnvelopeType` member + IPC command + boundary guard) plus the send path (builder +
connection method + registry delegate + main dispatch). Nothing fires it — the trigger is #1166 — and
nothing on the receive side changes.

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` (the `'request_session_settings'` member and its
  docblock, sited immediately before `'session_settings'` — the ordering this slice mirrors),
  `RequestSessionSettingsPayload` (the one-required-string precedent), `ModelListPayload` (the frame
  this asks for; states the "never block a model menu on this frame" rule the no-retry decision rests
  on).
- `src/shared/ipc/commands.ts` → `RendererCommand` (the sealed union), `isRendererCommand` (the
  boundary switch), `isRequestSessionSettingsPayload` (the guard shape to mirror), `hasValidServerId`
  (records that structured clone PRESERVES an explicitly-`undefined` own property — the fact that makes
  the `'payload' in value` check insufficient on its own).
- `src/main/transport/requestSessionSettingsEnvelope.ts` → `buildRequestSessionSettings`,
  `RequestSessionSettingsInput` — the file-shape, docblock posture and MAIN-PROCESS-ONLY note the new
  builder follows. Its `conversationId?` optionality and `?? ''` normalisation are exactly what this
  slice does NOT copy.
- `src/main/transport/requestSessionSettingsEnvelope.test.ts` → the three-test shape (round-trip
  through the REAL codec, verbatim id, `Object.keys` = the one key).
- `src/main/daemonConnection.ts` → `DaemonConnection` (the interface the new method joins),
  `requestSessionSettings` (the send-twin body: `driver === null` guard, shared `nextEnvelopeId`,
  advance-on-successful-build, content-free `catch {}`).
- `src/main/connectionRegistry.ts` → `ActiveConnection` (`Omit<DaemonConnection, 'start' | 'stop' |
  'reconnect'>`), `viewOf` (the delegation list written exactly once — the new method owes one line).
- `src/main/connectionRegistry.test.ts` → `createFactoryFake` — a full `DaemonConnection` object
  literal, so it breaks on **tsc alone**, not on vitest. `npm run build` is the gate that catches it.
- `src/main/index.ts` → the `onCommand` switch, `case 'requestSessionSettings'` (the
  `router.route(id)?.method(id)` one-liner and its ONE-local rationale).
- `src/main/conversationRouter.ts` → `ConversationRouterDeps`, `MAX_INDEXED_CONVERSATIONS` — the
  refuse-don't-fall-back posture that makes "a conversation no live connection hosts sends nothing"
  true without a branch in the switch.
- `docs/knowledge/features/session-settings-send.md` § The five pieces / § Security properties — the
  lesson that the BUILDER's fresh literal, not the structural-minimum guard, is what bounds the wire.
- `docs/knowledge/features/model-list-store.md` § "there is no request half … and there must never be
  one" — scoped to the **renderer store path**; see § Prohibitions below.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and none is owed. This slice adds one wire type,
one IPC union member, one pure builder, one connection method and one dispatch case; it puts nothing
under `src/renderer/` and renders nothing. The visual-fidelity check is intentionally skipped.

## Context

`model_list` is the only wire form of the model/effort vocabulary, and both existing delivery lanes
(the per-child-spawn live emit, and the connect-time reconcile inside the handshake tail) structurally
miss a conversation created **after** this app connected. pyrycode#2125 added `request_model_list` to
close that window. This app has no client half at all. This ticket adds the ask and stops.

No ADR is owed: this is an additive member on four existing contracts, each of which already documents
its own extension rule in its module header.

## Design

Six production files, in dependency order.

### 1. `src/shared/wire/types.ts` — the declaration

- `EnvelopeType` gains `| 'request_model_list'`, sited **immediately before** the `'model_list'`
  docblock, mirroring how `'request_session_settings'` sits immediately before `'session_settings'`.
  Its docblock records: v2-only client→daemon control frame, `interactive`-gated (inert on a conn that
  did not negotiate it), carries `RequestModelListPayload`, answered by ONE `model_list` correlated by
  `in_reply_to` and carrying **no `event_id`** (so the reconnect `last_event_id` dedup is inert for it,
  exactly as for the reconciled frame), payload identical to what the connect-time reconcile would have
  sent — including for a conversation with **no bound session**, answered from the daemon-wide
  vocabulary (pyrycode#2124). A request the daemon cannot answer draws one `error` frame instead:
  `conversation.not_found` (not retryable) or `model_list.unavailable` (retryable) — and **neither is
  retried here**; see § Error handling.
- `RequestModelListPayload { conversation_id: string }` — one **required** string, no `omitempty`
  upstream, sited beside `ModelListPayload`. Its docblock states the divergence from
  `RequestSessionSettingsPayload`: that verb's id is optional because an unnamed request draws a
  zero-valued reply; this one has nothing to ask about without an id, so `''` is not a meaningful
  request and the whole chain types the id as required.

**The `EnvelopeType` member is not typechecked** (`Envelope.type` is `EnvelopeType | string`). It is a
deliberate edit, not a consequence of the others, and the builder's test asserting the decoded
`envelope.type` does not catch its absence either — nothing does. Written first, on purpose.

### 2. `src/main/transport/requestModelListEnvelope.ts` (new) — the builder

```ts
export interface RequestModelListInput { id: number; ts: string; conversationId: string }
export function buildRequestModelList(input: RequestModelListInput): Uint8Array
// Envelope { id, type: 'request_model_list', ts, payload: { conversation_id } } → encodeEnvelope bytes
```

A sibling of `requestSessionSettingsEnvelope.ts` — same one-concern-per-file split, same
MAIN-PROCESS-ONLY note (it imports `codec.ts`/Node `Buffer`; never re-exported through a renderer
barrel). Two deliberate divergences from that precedent, both stated in the docblock:

- `conversationId` is **required**, so there is no `?? ''` normalisation and no "absent names nothing"
  case to document. A request with no conversation to name has nothing to ask about.
- It builds a **fresh literal** naming exactly `conversation_id` — never a spread of a caller's object
  — which is what bounds the outbound wire regardless of what the structural-minimum boundary guard
  admitted (the `session-settings-send` § Security properties lesson).

May throw `WireEncodeError` in principle; a fixed-shape envelope plus one client-owned id cannot
approach `MAX_PLAINTEXT_BYTES`, and the sole caller catches regardless.

### 3. `src/main/daemonConnection.ts` — the connection method

`DaemonConnection` gains `requestModelList(conversationId: string): void`, and
`createDaemonConnection` gains the matching function plus its entry in the returned object. A faithful
`requestSessionSettings` twin for the send mechanics: `driver === null` → inert no-op; shares the one
monotonic `nextEnvelopeId` (no second counter — the daemon correlates the reply by `in_reply_to`);
advances the id only on a successful build; `catch {}` drops the caught object with **no log and no
event** (classify-don't-forward). A request sent while disconnected simply produces no reply, and #1166
re-asks on the next conversation open.

### 4. `src/main/connectionRegistry.ts` — one delegate line

`viewOf` gains `requestModelList: (conversationId) => resolve().requestModelList(conversationId)`.
`ActiveConnection` is derived by `Omit`, so it widens for free; the member list is written exactly once
here by design. **`connectionRegistry.test.ts`'s `createFactoryFake` builds a full `DaemonConnection`
literal and therefore breaks on tsc, with vitest still green** — it gains `requestModelList: noop`.

### 5. `src/main/index.ts` — the dispatch case

```ts
case 'requestModelList': {
  const conversationId = command.payload.conversation_id
  router.route(conversationId)?.requestModelList(conversationId)
  return
}
```

ONE local read twice, so the id routed by and the id sent can never be two different expressions —
the `requestSessionSettings` case's own rationale. Routed by conversation (#1118): `router.route`
answers the owning server's connection, or `null` **having already refused and logged**, so an id no
server has claimed puts a frame on no wire at all. No `?.` on `command.payload` — the payload is
required and the boundary guard has already proven it.

### 6. `src/shared/ipc/commands.ts` — the command + guard

- `RendererCommand` gains `| { type: 'requestModelList'; payload: RequestModelListPayload }` (payload
  **required**, so a bare send is a compile error), sited beside `requestSessionSettings`, with the
  union docblock's prose extended by two sentences.
- `isRendererCommand` gains `case 'requestModelList': return 'payload' in value &&
  isRequestModelListPayload(value.payload)`. The lockstep discipline the file's header names: the
  member and its case land together or the member is silently dropped at the boundary.
- `isRequestModelListPayload(value)` — `isRequestSessionSettingsPayload` with the key unchanged and
  the name changed: object-and-not-null, then present-and-string `conversation_id`. **The
  explicitly-`undefined` payload is refused by this guard, not by the `in` check** — structured clone
  preserves an own property holding `undefined`, which `hasValidServerId`'s docblock already records.

## State + concurrency model

No new state, no new store slice, no new async task, no timer, no listener, no subscription. The
command is fire-and-forget: the method returns synchronously after `driver.sendMessage`, and the reply
arrives on the existing inbound path as an ordinary `model_list` frame. Nothing to cancel, so nothing
owes an `AbortSignal` or a teardown handle. No pending-request map (contrast `pendingSettings` in
`setSessionSettings`): the answer is `model_list`, which `modelListBridge` already lands in
`modelListStore` keyed by `conversation_id`, so there is no correlation this slice must perform and no
entry that could outlive a `dial()`.

`nextEnvelopeId` is shared with every other sender on the connection, which is what keeps ids unique
across interleaved calls.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends a malformed `requestModelList` (no payload, `payload: undefined`, non-string id, no id) | `isRendererCommand` / `isRequestModelListPayload` | dropped at the boundary, no frame |
| Command names a conversation no live connection hosts | `conversationRouter.route` | `null` having already refused and logged; `?.` sends nothing and throws nothing |
| Not connected when the method is called | `daemonConnection` (`driver === null`) | inert no-op; no throw, no event |
| Over-cap build / driver throw | the method's `try`/`catch` | caught, dropped — no log, no event; the envelope id is not consumed |
| Daemon answers `error` with `conversation.not_found` or `model_list.unavailable` | existing `daemon-error` path | falls through `narrowDaemonErrorOutcome`'s allowlist to `unclassified`, unchanged |
| Conn did not negotiate `interactive` | daemon | the request is inert; no reply, no error |

**No retry, deliberately, and no error-outcome widening.** A client-side retry against a relay
withholding the frame is the self-inflicted spin `modelListStore`'s header forbids, and no consumer may
block a model menu on this frame. Adding either code to the outcome union is a three-file change (the
union, its re-declared copy on the shared IPC side, and `AttachmentTransferFailure` which inherits it
whole); surfacing a refusal to the operator is #1036's job.

## Prohibitions this slice does not violate

`modelListBridge.ts`, `modelListStore.ts`, `App.tsx` and `clearPairingScopedState.ts` each state that
the model-list path has "no request half", two of them adding "none may be added" / "there must never
be one". Those claims are scoped to the **renderer store path**, and the reasoning under them — no
client-side retry, never block a menu on this frame — is preserved verbatim above. This slice puts
nothing in `src/renderer/`, so the renderer path still has no sender the moment it lands. **Those four
files are not edited.** The correction rides #1166, the slice that adds the sender.

## Testing strategy

All vitest (node environment). No renderer surface, so no `renderToStaticMarkup` spec; no interaction,
so no Playwright spec.

- `src/main/transport/requestModelListEnvelope.test.ts` (new) — mirrors
  `requestSessionSettingsEnvelope.test.ts` against the REAL codec: round-trips to a
  `request_model_list` envelope carrying the exact id and ts; carries the named conversation id
  verbatim (asserted against a value distinct from every other string on the envelope, so a
  transposition against `ts` cannot pass); `Object.keys(payload)` is exactly `['conversation_id']` —
  the "one field reaches the wire" assertion, which is what would redden if a second selector were ever
  added.
- `src/shared/ipc/commands.test.ts` — accepts a `requestModelList` naming a conversation (type, not
  emptiness: `''` passes here and is refused by the daemon); rejects no payload, `payload: undefined`,
  `payload: null`, `payload: {}`, and a non-string id; a `@ts-expect-error` pin that a bare send does
  not compile, mirroring the `requestSessionSettings` payload-required test.
- `src/main/daemonConnection.test.ts` — no-op before `start()` (no driver, nothing forwarded, no
  throw); a connected call puts exactly one `request_model_list` frame on the driver carrying
  `{ conversation_id: 'conv-42' }`.
- `src/main/connectionRegistry.test.ts` — the factory fake gains `requestModelList: noop`. This is a
  **tsc-only** break: vitest stays green without it, so `npm run build` is the gate.

Deliberately untested: `src/main/index.ts`'s dispatch case (no unit test exists for that file, by the
design `connectionRegistry.ts`'s header records) and the `EnvelopeType` member (nothing typechecks it;
its correctness rides the builder test's decoded `envelope.type` assertion only insofar as the string
literal matches, which is a separate fact from union membership).

## Size

Six production files against the size-S ceiling of five, and the overage is deliberate and stated.
The only clean cut is declaration (wire type + IPC command + guard) from send path, and the
declaration's sole consumer is the send path in this same slice — a one-consumer child, which the
floor rule says to merge back even at the cost of a ceiling line. Every other boundary holds: ~450
lines of total written work (≤800), 3 new exported symbols (≤5), 2 consumer call sites for the widened
`DaemonConnection` (`viewOf` + the registry test's factory fake, ≤10), 4 acceptance criteria (≤5), 0
reject branches.

## Open questions

1. Does `narrowDaemonErrorOutcome` really leave both new codes at `unclassified`? Confirmed by
   inspection before implementing — neither string appears anywhere under `src/`. **Resolved: yes**,
   and nothing is owed here.
2. Where exactly does the `EnvelopeType` member sit? Resolved above: immediately before the
   `'model_list'` docblock, matching `request_session_settings`/`session_settings`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary is explicit and singular: `isRendererCommand` →
  `isRequestModelListPayload` in `src/shared/ipc/commands.ts`, the same untrusted-renderer → trusted-main
  crossing every sibling command uses. Past it, `conversation_id` reaches exactly three sinks and no
  others. (a) `conversationRouter.route` uses it as a **`Map` lookup key** — the ticket's "never a key"
  rule is about a *cache* key that stores caller data; this is a read-only `get` against an index the
  main process built from the daemon's own `conversationsReceived`/`conversationCreated` events.
  `route()` **never inserts** — only `learn()` does, and `learn()` is fed by daemon events alone — so a
  renderer naming arbitrary ids cannot grow the index past `MAX_INDEXED_CONVERSATIONS` or poison it.
  It is a `Map` rather than a `Record`, so `__proto__` as an id is inert. (b) `buildRequestModelList`
  puts it in a **fresh literal**, never a spread, so nothing a compromised renderer smuggled past the
  structural-minimum guard can reach the wire. (c) Nothing else — no filesystem path, no log line, no
  attribute, no URL.
- **[Trust boundaries — the one state change a renderer can drive]** No finding, pre-existing and
  unchanged. `route()` **deletes** the index entry when the named conversation's server has no live
  connection. A compromised renderer can therefore evict mappings by naming ids. This is not a
  capability this slice adds: `sendMessage`, `requestSessionSettings`, `promoteConversation` and every
  other conversation-routed command drive the identical delete today, and the delete fires only on a
  mapping that was **already unroutable** — the entry is re-learned from the next conversation list.
  Named rather than waved past, because it is the only mutation on this path.
- **[Tokens, secrets, credentials]** Not applicable, by construction rather than by luck. This slice
  mints nothing, stores nothing and reads nothing at rest: no RNG (contrast `answerModal`'s
  `answer_token`), no `safeStorage` touch, no lifecycle to rotate or revoke. `conversation_id` is a
  client-owned routing id in the `SetSessionSettingsPayload.session_id` class — non-secret, and the
  renderer that supplies it already holds it.
- **[File / storage operations]** Not applicable — no path is constructed, no file is opened, read or
  written anywhere on this path. There is no `path.join`, no check-then-open, and no on-disk state.
- **[Inter-process / Electron attack surface]** No findings. **No new IPC channel and no new
  `contextBridge` API** — one additive member on the existing, already-validated `COMMAND_CHANNEL`,
  registered at the single `ipcMain.on` site. The capability it grants a compromised renderer is: ask
  the daemon for the model vocabulary of a conversation the renderer can already name. That is
  strictly weaker than `sendMessage`, which the same channel already admits for the same id. The
  channel is **fire-and-forget** (`ipcMain.on`, no return value), so the command is not an oracle
  either: a renderer probing ids learns nothing about which server hosts what, and the refusal path
  logs a static code with no id and no server (`DiagnosticEvent` has no identifier-shaped field).
  No window config, navigation handler, protocol registration or remote content is touched.
- **[Cryptographic primitives]** Not applicable — no primitive, no key, no nonce, no comparison. The
  frame rides the existing Noise session through `driver.sendMessage`; the handshake, the AEAD and the
  per-direction counters are untouched, and nothing here is re-implemented.
- **[Network & I/O]** No findings, with one property named rather than assumed. No new socket, no new
  timeout, no new frame-size surface (the outbound envelope is fixed-shape plus one short id, orders
  of magnitude under `MAX_PLAINTEXT_BYTES`; the reply lands under the existing inbound cap applied in
  `parseInboundMessage` ahead of any parse). **Request amplification:** a compromised renderer can call
  this in a loop and put one envelope per call on the relay — identically to `requestSessionSettings`
  and `requestConversations` today; the command channel has no rate limit and this slice adds neither a
  new vector nor a new defence. What it does add is the **no-retry rule**, which is the control that
  stops the *honest* app from generating that spin on its own (§ Error handling).
- **[Error messages, logs, telemetry]** No findings. The connection method's `catch {}` drops the
  caught object with **no log and no event** — classify-don't-forward, because a thrown object could
  echo the id. The builder logs nothing. `conversationRouter`'s refusal emits a static
  `event`+`code` pair only; widening it to carry the id would require widening a renderer-facing
  security contract (#126's allowlist, pinned by `receiveDiagnostic.test.ts`'s `Omit`), which this
  slice does not do. No `console.*` is added anywhere.
- **[Concurrency]** Not applicable, by design: the whole path is synchronous. No `await`, so no
  check-then-act gap; no timer, listener, subscription or long-lived task, so nothing owes an
  `AbortSignal` and `will-quit` has nothing new to tear down. The one piece of shared mutable state
  touched is `nextEnvelopeId`, a main-process single-writer counter incremented synchronously between
  a successful build and the send, exactly as every sibling sender does. Deliberately **no pending-request
  map** (contrast `pendingSettings`), so there is no entry that could outlive a `dial()` and no
  unbounded growth from unanswered requests.
- **[Threat model alignment — hostile relay]** Addressed. The relay is on-path and content-blind: it
  can drop, delay or reorder the request and the reply. The design survives that with no liveness
  assumption at all — nothing blocks on the frame, no timer waits for it, and the no-retry rule means a
  withheld reply produces no traffic rather than a spin. This is the `modelListStore` header's rule,
  preserved.
- **[Threat model alignment — hostile daemon / forged reply]** No finding, and the **absence of a
  fail-closed correlation here is a decision, not an oversight.** One might expect a `pendingSettings`-style
  `in_reply_to` map so a forged `model_list` cannot be attributed to a request the client never sent.
  It would buy nothing: `model_list` is an **accept-unsolicited snapshot by contract** — the connect-time
  reconcile lane delivers a burst of them outside any request, and the frame carries no `event_id` — so
  a daemon that can forge a reply can already push the identical frame unsolicited today, through a
  lane this slice does not touch. Requiring correlation would break the existing lanes and would force
  the receive path to branch on whether a frame answered a request, which AC4 explicitly forbids. The
  content is defended where it actually matters: `ModelListPayload` is reached through the fail-closed
  narrower (#971–#973), never a bare `as`, and a model value sent back on `set_session_settings` is
  re-validated daemon-side at `validModel` rather than trusted for having appeared in a published list.
- **[Threat model alignment — renderer compromise reaching the transport]** No finding. Process
  isolation is unchanged: the builder is **MAIN-PROCESS ONLY** (it imports `codec.ts` and Node
  `Buffer`) and is never re-exported through a renderer barrel, so no raw bytes, key or socket becomes
  reachable from the web layer. The renderer's whole reach on this path stays one validated string.
- **[Out of scope]** Surfacing a `conversation.not_found` / `model_list.unavailable` refusal to the
  operator is **#1036**. Adding either code to `narrowDaemonErrorOutcome`'s allowlist is deliberately
  not done here (a three-file change across the outcome union, its re-declared copy on the shared IPC
  side, and `AttachmentTransferFailure` which inherits it whole); both fall through to `unclassified`,
  which is correct and complete for this slice. The renderer sender that fires this command is **#1166**.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
