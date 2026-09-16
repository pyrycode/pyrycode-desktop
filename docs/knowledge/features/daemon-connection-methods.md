# Daemon connection — methods

The public surface: every outbound method `DaemonConnection` exposes, and the ticket that added,
widened or removed each one.

Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its
edge cases and its links.

## Public surface

```ts
export interface DaemonConnectionDeps {
  deviceKeypair: DeviceKeypairStore   // .ensure() → device static private key (the initiator `s`)
  pairedServer: PairedServerStore     // .load()   → record | null
  sink: DaemonEventSink               // the emitDaemonEvent target — a BrowserWindow satisfies it structurally
  serverId: string | null             // #1068: which server this connection speaks to; bound once, stamped on every event this connection emits — see the daemon-event-channel-plumbing.md `bindServerOrigin` section
  deviceName: string                  // sourced at the root (os.hostname()); rides in the hello for display/audit
  clientVersion: string               // sourced at the root (app.getVersion()); hello + relay User-Agent
  now?: () => string                  // RFC3339 clock for the hello ts; default () => new Date().toISOString()
  createDriver?: (config: NoiseRelayDriverConfig) => NoiseRelayDriver  // DI seam; default createNoiseRelayDriver
  diagnosticLog?: DiagnosticLog       // #126 content-free logger, injected at the root; the daemon-leg log sites consume it (#128), and a second downward path routes it into the driver's framing catch + session builds (#133)
}

export interface DaemonConnection {
  start(): void      // idempotent; emits `connecting`, then sources inputs + constructs the driver
  stop(): void       // idempotent teardown: stop the driver; suppress the resulting terminal
  reconnect(): void  // #82: tear down any driver + dial fresh, re-sourcing the record; no-op once stopped
  send(payload: SendMessagePayload): void  // #65: encrypt a send_message onto the live session
  requestDebugBundle(): void  // #115: encrypt a bare request_debug_bundle control frame onto the live session
  // requestSnapshot(payload) — #180, removed #620: encrypted a request_snapshot onto the live session
  requestConversations(): void  // #139: encrypt a bare list_conversations control frame onto the live session
  requestSessionSettings(conversationId?: string): void  // #491, widened #945: encrypt a request_session_settings onto the live session; the builder normalises an absent id to conversation_id: ''
  requestModelList(conversationId: string): void  // #1165: encrypt a request_model_list onto the live session; the id is REQUIRED, unlike its bare-optional sibling above
  requestHistory(payload: RequestHistoryPayload): void  // #1222: encrypt a request_history onto the live session, asking for one backward step of a scroll-back walk; takes the WHOLE payload (three fields), unlike its two neighbours above; answered by history_page → historyPageReceived or error → historyRequestFailed, correlated by envelope id since the reply names no conversation
  requestSystemPrompt(conversationId: string): void  // #1230: encrypt a request_system_prompt onto the live session, asking what system prompt a conversation holds and whether the running session was started with a different one; the id is REQUIRED, requestModelList's rule; answered by ONE system_prompt → systemPromptReceived, correlated by envelope id since the reply names no conversation, and by NOTHING ELSE — this verb has no error frame at all, so nothing retries and an unroutable id must be refused before the send
  newSession(conversationId: string): void  // #1217: encrypt a new_session onto the live session — KILLS claude and spawns a fresh one under a new session id; the id is REQUIRED (unlike the wire type, which mirrors the daemon's optional field); fire-and-forget, NO reply of any kind
  createConversation(payload: CreateConversationPayload): void  // #241: encrypt a create_conversation onto the live session, fresh-literal net
  setSessionSettings(payload: SetSessionSettingsPayload, changeId: string): void  // #263: encrypt a set_session_settings onto the live session, omitempty presence contract owned by the builder; #261 added changeId + pending-map correlation
  uploadAttachment(input: AttachmentChunkPlanInput): Promise<AttachmentTransferResult>  // #861: drive a planAttachmentChunks() result onto the live session and resolve on the one terminal; consumer-failing twin like requestDebugBundle, not send's silent no-op
  requestAttachment(payload: RequestAttachmentPayload, consumer: AttachmentRetrievalConsumer): void  // #996: encrypt a request_attachment onto the live session and route the answering chunk stream / reject to consumer; consumer-failing twin, void not Promise (the consumer, not the return, carries the terminal)
}

export function createDaemonConnection(deps: DaemonConnectionDeps): DaemonConnection
```

**`send(payload)` was added in [#65](../codebase/65.md)** — the outbound send entry point. It builds a `send_message` envelope (via `buildSendMessage`, id counter continuing from 2 after the hello's id 1) and hands the bytes to `driver.sendMessage`. It is an **idempotent no-op** when not connected (no driver, pre-handshake, or post-terminal) and **never throws out of the module** (a single `driver === null` guard plus a full-body `try/catch`; parity mobile #490). See the [outbound send path](outbound-send-path.md) feature doc for the full contract — the id-counter model, the "why a single guard suffices" case analysis, and the composition-root `onCommand` registration that drives it.

**`requestDebugBundle()` was added in [#115](../codebase/115.md)** — a **structural twin of `send`** for the debug-bundle download's outbound "ask". It builds a **bare `request_debug_bundle` control envelope** (no payload struct, no `conversation_id`, no session selector — the bundle is daemon-global) via `buildRequestDebugBundle` and hands the bytes to `driver.sendMessage`. It **shares the same `nextEnvelopeId` counter** as `send` (no second counter — ids stay monotonic across interleaved calls), is an idempotent no-op when not connected, and never throws (parity #490). The renderer command that calls it is wired by the [debug-bundle orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md), landed — the orchestrator half of #118's split; the IPC contract itself shipped in [#168](debug-bundle-request.md)). See the [debug-bundle request](debug-bundle-request.md) feature doc for the full contract, including why "no payload" is a present-but-empty `payload: {}` rather than an omission.

**`uploadAttachment(input)` was added in [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861)** — the third **consumer-failing
twin**, alongside `requestDebugBundle`: the caller awaits a terminal, so a request made while disconnected
resolves `{ ok: false, outcome: 'not-connected' }` rather than hanging like `send`'s silent no-op. It
drives a `planAttachmentChunks()` result onto the live session chunk by chunk via a new
[`AttachmentTransfer`](attachment-transfer.md) state machine, and correlates the daemon's two terminal
answers with **two different keys** — the success reply by the payload's `attachment_id` (the only inbound
arm in this file that correlates on a payload field rather than `Envelope.in_reply_to`), the rejects by
scanning the live transfers' sent envelope ids, the fifth member of the `daemon-error` precedence tier (see
[Daemon connection — correlation](daemon-connection-correlation.md) § Attachment-upload correlation). It is
the **first `async` method** on this interface and never throws or rejects out of the module (parity #490,
restated for a promise-returning method). See [Attachment transfer](attachment-transfer.md) for the full
design, including why the envelope-id-only correlation the two existing patterns suggest would never
resolve.

**`requestAttachment(payload, consumer)` was added in [#996](https://github.com/pyrycode/pyrycode-desktop/issues/996)**
— the retrieval leg's consumer-failing twin, `void` rather than `Promise`-returning like
`uploadAttachment` because the terminal reaches the caller through `consumer.fail`/`consumer.complete`,
not a resolved value. Builds and **sends the frame before** registering the correlation entry
(`pendingRetrievals: Map<number, PendingRetrieval>`, keyed by the sent envelope id) — the opposite
order from every other arm-before-send precedent in this file, fixed post-review; see
[Attachment retrieval](attachment-retrieval.md) § Revisions for why this map specifically needs it.
Every answering chunk **and** the reject correlate on that one envelope id (unlike the upload leg's two
different keys), plus a per-retrieval idle deadline this ticket introduces as the first timer this
module owns. See [Attachment retrieval](attachment-retrieval.md) and
[Daemon connection — correlation](daemon-connection-correlation.md) § Attachment-retrieval correlation
for the full design.

**`requestSnapshot(payload)` was added in [#180](../codebase/180.md) and removed in
[#620](../codebase/620.md).** It was the outbound half of an on-demand fetch of the session's current
model/effort/YOLO via the daemon's always-available `screen_snapshot` reply (ADR-025, not gated on
`interactive`). Unlike `requestDebugBundle`, it was the **`send` twin, not a consumer-failing twin**:
a snapshot had no consumer, so it stayed an inert no-op (`driver === null` → return) rather than
failing a `BundleConsumer`. It built a **payload-carrying** `request_snapshot` envelope (a real
`conversation_id`, unlike the bare debug-bundle frame) via `buildRequestSnapshot` (also deleted),
shared the one `nextEnvelopeId` counter, and never threw (parity #490). #620 removed the method, its
interface declaration, and its entry in the returned object literal — the `DaemonConnection` interface
no longer declares it. The reply's inbound decode and content-minimisation emit were removed in turn:
[#621](../codebase/621.md) deleted the `case 'snapshot':` emit, and [#622](../codebase/622.md) deleted
the decode itself (`parseScreenSnapshotPayload`, the `snapshot` `InboundDaemonMessage` kind, and the
`screen_snapshot`/`ScreenSnapshotPayload` wire types) — a `screen_snapshot` frame now falls to
`parseInboundMessage`'s tolerant `default` arm. See the
[screen snapshot fetch](screen-snapshot-fetch.md) feature doc for the full history.

**`requestConversations()` was added in [#139](../codebase/139.md)** — the outbound half of the
[conversation list fetch](conversation-list-fetch.md). Like `requestSnapshot`, it is the **`send`
twin, not `requestDebugBundle`'s consumer-failing twin**: a list request has no consumer, so it stays
an inert no-op (`driver === null` → return) rather than failing a `BundleConsumer`. Unlike
`requestSnapshot`, it builds a **bare** `list_conversations` envelope (no payload — the request
selects nothing) via `buildListConversations`, mirroring `requestDebugBundle`'s bare-builder shape
instead. Shares the one `nextEnvelopeId` counter, never throws (parity #490). It has no caller in
this ticket — [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208) triggers it via
`sendCommand` on connect. The reply is routed through the same `case 'message'` seam and emits a
fresh `conversationsReceived` literal reusing the decoded array **verbatim** — unlike
`snapshotReceived` (removed [#621](../codebase/621.md)), there is no sensitive field to drop.

**`createConversation(payload)` was added in [#241](../codebase/241.md)** — the write-side twin of
`requestConversations`, asking the daemon to create a fresh conversation (all three fields nullable,
`null` = "let the daemon choose"). Since #1367 it requires an authenticated session and
emits host-stamped, content-free `conversationCreateRejected` on an unavailable connection
or a local build/send failure. A driver can survive relay loss; its existence alone cannot
admit creation. It shares `nextEnvelopeId` and never throws transport/build errors to callers.
Unlike `requestSnapshot`/`requestConversations`, it builds a **fresh literal** naming exactly the
three modeled fields (`{ is_promoted: payload.is_promoted, name: payload.name, cwd: payload.cwd }`)
before calling `buildCreateConversation` — never a spread of the caller's `payload` — the
deterministic net that bounds the outbound wire to exactly those three fields regardless of what the
structural-minimum `isCreateConversationPayload` guard let through (the [#236](../codebase/236.md)
fresh-literal posture, reused here for the first `send`-family method carrying more than one field).
The reply is routed through the same `case 'message'` seam as a new `case 'conversation-created':`,
emitting `conversationCreated` as a verbatim passthrough — nothing to drop, like `conversations`. Its
callers include the [new-discussion FAB](new-discussion-fab.md), workspace-row create actions
and [Add workspace dialog](add-workspace-dialog.md). See [Conversation create — Error
handling](conversation-create.md#error-handling) for local feedback and the dialog's bounded wait.

**`setSessionSettings(payload, changeId)` was added in [#263](../codebase/263.md)** (send) and widened
with `changeId` in [#261](../codebase/261.md) (correlation) — the outbound send half of a per-session
model/reasoning-effort/YOLO change (pyrycode #844/#845), the write-side counterpart of `requestSnapshot`.
Another **`send` twin** (inert no-op when `driver === null`, no consumer to fail), sharing the one
`nextEnvelopeId` counter, never throws (parity #490). Unlike `createConversation`'s
fresh-literal-in-the-method pattern, this method passes `payload` straight through — the fresh literal
**and** the omitempty presence contract (an absent field means "leave unchanged," a field present at its
zero value `''`/`false` means "set to this value") both live in `buildSetSessionSettings`
(`setSessionSettingsEnvelope.ts`) instead, since the golden test targets the builder and the
conditional-key construction *is* the presence contract — co-locating both keeps the method a faithful
`requestSnapshot` clone. No empty-`session_id` guard (Evidence-Based Fix Selection — an empty/unknown id
is the daemon's `session.not_found` to reject, mirroring `requestSnapshot`'s `conversation_id`).

**#261** added the correlation half: the method now captures `envelopeId = nextEnvelopeId` before the
build and, only after a successful `driver.sendMessage`, records `pendingSettings.set(envelopeId,
changeId)` in a new module-local `Map<number, string>` sited beside `outstandingAnswers` (same
single-writer, push-after-send discipline). `changeId` is renderer-minted and **never** passed to
`buildSetSessionSettings` — it stays off the wire. Ships **dormant**: the caller is the interactive
Run-config controls ([#257](https://github.com/pyrycode/pyrycode-desktop/issues/257)). See [session
settings send](session-settings-send.md) for the full contract.

**`requestSessionSettings(conversationId?)` was added in
[#491](https://github.com/pyrycode/pyrycode-desktop/issues/491)** — the outbound half of the
[Run configuration store](run-config-store.md)'s read, replacing `requestSnapshot`'s inert
`screen_snapshot` fetch on the stream-json interactive runner (a daemon with no terminal to
photograph refused that reply outright). Another **`send` twin** (inert no-op when
`driver === null`, no consumer to fail), sharing the one `nextEnvelopeId` counter, never throwing
(parity #490). Shipped genuinely bare — the daemon's reply was not, at the time, addressed to any
conversation.
[#945](https://github.com/pyrycode/pyrycode-desktop/issues/945) widened the signature to
`requestSessionSettings(conversationId?: string): void` after the daemon made the frame
conversation-keyed on 2026-08-20 (pyrycode#1586/#1610, an unnamed request now silently drawing a
zero-valued reply instead of an error): the id is forwarded verbatim to
`buildRequestSessionSettings`, which owns the "absent → `conversation_id: ''`" normalisation, so this
method still holds no novel encode logic of its own. The never-log discipline in the catch block is
unchanged and is now load-bearing for a real payload field, not just an empty one.
[#946](https://github.com/pyrycode/pyrycode-desktop/issues/946) is the slice that made the sole
caller, `requestRunConfigSnapshot`, actually pass one — sourced from the renderer's own active
conversation state, or declined to send at all when none is addressable. The signature here stays
`conversationId?: string`: tightening it to required would buy no behaviour change once the sole
caller already resolves a real id before calling, so #946 left this method and
`buildRequestSessionSettings`'s `?? ''` normalisation untouched. See [Run configuration store §
Conversation-keyed since
2026-08-20](run-config-store.md#conversation-keyed-since-2026-08-20-945946) for the daemon-side
contract.

**`requestModelList(conversationId)` was added in [#1165](https://github.com/pyrycode/pyrycode-desktop/issues/1165)**
— a faithful `requestSessionSettings` twin for the send mechanics (inert no-op when `driver === null`,
sharing the one `nextEnvelopeId` counter, advancing the id only on a successful build, a content-free
`catch {}`), asking the daemon for one conversation's model/effort vocabulary on demand. It closes a gap
neither existing `model_list` delivery lane covers: a conversation created **after** this app connected
— see [Model-list wire types § Outbound ask](model-list-wire-types.md#outbound-ask-1165) for why both
pushed lanes miss it. **The one divergence from its sibling above is deliberate and stated in both
docblocks: `conversationId` is REQUIRED, not optional.** `requestSessionSettings`'s id is optional
because an unnamed request draws a silent zero-valued reply, a real answer; there is no zero answer to
"what models does nothing offer," so an unnamed ask here has nothing to ask about and the whole chain —
this method, the builder, the command payload, the boundary guard — types the id as required. Routed by
conversation through `conversationRouter.route` in `src/main/index.ts`'s dispatch case, exactly like
`requestSessionSettings`; a conversation no live connection hosts sends nothing and throws nothing. The
reply is one `model_list` correlated by `in_reply_to`, landed by the existing inbound path into the
[model-list store](model-list-store.md) exactly as it lands an unsolicited one — no new inbound case, no
new correlation map, and **deliberately no retry**: a retry against a relay withholding the frame is the
self-inflicted spin that store's header forbids. `connectionRegistry.ts`'s `viewOf` gained one delegate
line for it, and its test factory fake gained a `noop` — a **tsc-only** break, since the factory builds a
full `DaemonConnection` object literal (`npm run build` is the gate, not `npm test`). Ships with no
renderer sender at all — [#1166](https://github.com/pyrycode/pyrycode-desktop/issues/1166) is the trigger
that fires it on conversation open.

**`newSession(conversationId)` was added in [#1217](https://github.com/pyrycode/pyrycode-desktop/issues/1217)**
— asks the daemon to **kill** the supervised claude process in the named conversation and spawn a fresh
one under a new session id, so every stored setting (model, effort, permission mode, and the
per-conversation system prompt pyrycode#2094 introduces) re-applies at the spawn. **Not** a typed `/clear`
— that clears context in place and the process keeps everything it holds; this discards the process
outright, which is why it is the only route by which a stored per-conversation setting takes effect at all
(on the Mac the daemon's idle timeout is 0, so nothing evicts on its own). The Actions menu's Reset session
row dispatches this method directly as of [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496)
— until then the menu carried a separate row that sent `/clear` as ordinary message text; typing `/clear`
by hand is unaffected. Faithful `requestModelList` send
mechanics (inert no-op when `driver === null`, sharing the one `nextEnvelopeId` counter, advancing the id
only on a successful build, a content-free `catch {}`), and the **same** required-id divergence from
`requestSessionSettings`'s optional one, for a stronger reason still: an unnamed `new_session` is not
merely useless, it restarts whichever conversation the daemon's process-wide follow-active cursor points
at — another connection's conversation, mid-work (pyrycode#2099). Routed by conversation through
`router.route` in `src/main/index.ts`'s dispatch case, exactly like `requestModelList`; a conversation no
live connection hosts sends nothing and throws nothing. **Unlike `requestModelList`, there is no reply at
all** — not `model_list`, not an error — so there is no correlation map and nothing for the inbound path
to route back; the only observable effect is the pre-existing `session_transition` marker. No retry, ever
— a restart is destructive and unacknowledged, so a resend would be a second kill rather than a second
attempt at the first. `connectionRegistry.ts`'s `viewOf` gained one delegate line (23 → 24 members) and
its test factory fake gained a recorder, the same **tsc-only** break shape as #1165's addition. Ships with
no renderer sender at all — the sibling ticket adds the trigger and whatever confirmation it needs before
discarding a running turn's context. See [New session envelope](new-session-envelope.md) for the full
wire contract, the builder, and why the wire type's `conversation_id` stays optional while every layer
above it makes the id required.

**`interrupt()` was added bare in [#306](../codebase/306.md) and widened to `interrupt(conversationId)`
in [#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092).** From #306 through
[#1120](https://github.com/pyrycode/pyrycode-desktop/issues/1120) it took no argument at all — the
daemon stopped whichever conversation its process-wide follow-active cursor pointed at, and #1120 routed
it by *server* (`serverId?`) purely for want of an id of its own. pyrycode#2103 published an optional
`conversation_id` on the frame, validated against the daemon's registry, and #1092 threads it end to
end: the **same** required-scalar shape as `newSession` immediately above, for the same reason — an
unnamed interrupt is the shared cursor, which is another conversation's turn as often as it is this
one's. Faithful `newSession` send mechanics otherwise (inert no-op when `driver === null`, sharing the
one `nextEnvelopeId` counter, advancing the id only on a successful build, a content-free `catch {}`
whose caught object is dropped because it could now echo the id — the old "nothing sensitive on this
bare path" rationale is gone). **Unlike `newSession`, this method predates #1092 and had a caller
already** — the composer's two Stop affordances — so #1092 is a widening of an existing signature, not a
new method with a not-yet-built trigger. Routed by conversation through `router.route` in
`src/main/index.ts`'s dispatch case, exactly like `newSession`, replacing #1120's `serverRouter.ts` path
entirely — `interrupt` is the one member #1120 shipped that later left its server-scoped set (see
[Daemon connection — routing § Server-scoped command routing (#1120)](daemon-connection-server-scoped-routing.md)).
No reply of any kind, as before: the turn-stopped signal still rides the pre-existing
`turn_state`/`turn_end` stream, not a correlation this method owns. See [Interrupt
envelope](interrupt-envelope.md) for the full wire contract, the builder, and the render affordance
this method serves.

**`answerQuestions(payload)`/`refuseQuestions(payload)` were added in
[#920](https://github.com/pyrycode/pyrycode-desktop/issues/920)** — the resolution half of the question
vertical, one dial after [#919](https://github.com/pyrycode/pyrycode-desktop/issues/919) landed the
builders with no caller. Both share `answerModal`'s send mechanics: a
resolution has no consumer to fail, so each is an inert no-op when `driver === null`, sharing the one
`nextEnvelopeId` counter, never throwing (parity #490). Both mint a fresh `answer_token` via the
existing `mintToken` seam — **unlike the modal pair, both question frames carry a token**, so both
methods mint, where only `answerModal` does on its side. `answerQuestions` builds a fresh literal
naming the three modeled fields, and the rebuild is **deep**: each `answers` entry is rebuilt as
`{ question_index, values }` rather than passed through by reference, because `buildQuestionAnswer`
serializes the payload verbatim and a shallow `answers: payload.answers` would carry any extra key
smuggled onto an *entry* — past the renderer-side `isAnswerQuestionsPayload` guard — straight onto the
wire; `values` itself rides without a copy, since `JSON.stringify` serializes an array by index and no
own property on it can ride along. `refuseQuestions` builds a two-field literal (`question_batch_id`
plus the token it mints) — unlike `cancelModal`, which carries no token at all, because
`question_refused` carries one on the wire. **Neither pushes onto `outstandingAnswers` or any other
correlation map**: the daemon emits no reply and no error envelope for a rejected question answer, so a
window here would hold an entry nothing ever drains — the deliberate omission `answerModal`'s #248
correlation doesn't have. The over-cap `WireEncodeError` out of `buildQuestionAnswer` is a **live**
catch here, not defensive — `values` are operator-typed free text and nothing bounds entry count or
value length — while `refuseQuestions`'s own over-cap path stays exotic (two ids, no free text); both
catches drop the caught object without logging it, since its message could echo the batch nonce or an
entry value. The renderer buttons that dispatch these are a later slice; every control on the question
panel's action row stays inert as to answering until they land. See [question resolution
envelope](question-resolution-envelope.md) for the wire contract and builders, and [command
channel](command-channel.md) for the `answerQuestions`/`refuseQuestions` `RendererCommand` members and
guards that route here via `src/main/index.ts`'s `onCommand` switch.

**`case 'session-transition'` was added in [#254](../codebase/254.md)** — no new outbound method;
`session_transition` is inbound-only, the daemon-initiated session-boundary marker. Unlike
`conversation-created`'s verbatim passthrough, this arm emits a **fresh literal carrying only
`newSessionId`** — the [screen snapshot](screen-snapshot-fetch.md) `snapshot` content-drop model
(#180) applied a second time: `previous_session_id`/`reason`/`occurred_at`/`workspace_cwd` are decoded
and validated one layer down but dropped here, since the not-yet-built renderer holder
([#259](https://github.com/pyrycode/pyrycode-desktop/issues/259)) retains only the current session id.

**`case 'session-settings-updated'` was added in [#264](../codebase/264.md)** and made
**correlation-gated, fail-closed** in **[#261](../codebase/261.md)** — no new outbound method;
`session_settings_updated` is inbound-only, the daemon's confirmation that a `set_session_settings`
(#263) request landed. #264 shipped it as an unconditional emit; #261 rewrote the case to read
`inbound.inReplyTo` (propagated by [inbound message decode](inbound-message-decode.md) from the
already-decoded `Envelope.in_reply_to`), short-circuit (no event) when it is `undefined` or matches no
`pendingSettings` entry (AC3 — covers a stale reply and a hostile daemon forging a confirmation for an
id the client never sent), and otherwise `delete` the entry and emit a **fresh literal carrying
`sessionId` + `changeId`** — the map's client-minted value, never the wire `in_reply_to` itself, which
never crosses to the renderer.

**`requestHistory(payload)` was added in [#1222](https://github.com/pyrycode/pyrycode-desktop/issues/1222)**
— the transport leg of conversation scroll-back: asks the daemon for one backward step of a walk over
a conversation's daemon-owned, append-only on-disk log (pyrycode#2112), the entries a client that
connected after they were written can otherwise never see. Faithful `requestModelList` send mechanics
otherwise (inert no-op when `driver === null`, sharing the one `nextEnvelopeId` counter, advancing the
id only on a successful build, a content-free `catch {}`). **Unlike every method above, it takes the
whole payload rather than a scalar** — three fields, `conversation_id`/`cursor`/`limit` — because the
builder (`requestHistoryEnvelope.ts`) rebuilds a fresh three-key literal from them, so nothing
renderer-supplied reaches the wire uninspected regardless of what the command guard let through. **It
is also the only request method that records what it asked**: `history_page` names no conversation at
all, so this method is the sole place "which conversation does this reply describe" exists — recorded
in a new `pendingHistoryRequests: Map<number, string>` after a successful send, the `pendingConfigRequests`
shape and ordering exactly, and matched back by the reply's `Envelope.in_reply_to`. Routed by
conversation through `router.route` in `src/main/index.ts`'s dispatch case, exactly like
`requestModelList`, reading `command.payload.conversation_id` once as both the routing key and the
field the builder consumes. Answered by one `history_page` → `historyPageReceived`, or one `error` →
`historyRequestFailed` (a **second** narrower, `HistoryRejectReason`, beside `narrowDaemonErrorOutcome`
rather than five members added to it — see [Request history send § The reject
path](request-history-send.md) for why); **no retry, ever**, for either outcome, including the one
retryable refusal — the walk's retry policy belongs to
[#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224). `connectionRegistry.ts`'s `viewOf`
gained one delegate line, the same tsc-only break shape as #1165's/#1217's additions. Ships with no
renderer sender at all and no render consumer — #1223 draws a page through the timeline reducer, #1224
walks, #1225 joins a page to the live stream; all four exhaustive bridges take null arms. See [Request
history send](request-history-send.md) for the full contract.

**`requestSystemPrompt(conversationId)` was added in [#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230)**
— asks the daemon what system prompt a conversation holds, and whether the running session was started
with a different one (pyrycode#2152's read verb; the write half, pyrycode#2151, shipped first). Takes
the conversation id as a **scalar**, `requestModelList`'s rule rather than `requestHistory`'s
whole-payload one, and the id is **required**: an unnamed request has nothing to ask about. Faithful
`requestModelList` send mechanics (inert no-op when `driver === null`, sharing the one
`nextEnvelopeId` counter, advancing the id only on a successful build, a content-free `catch {}`, no
retry). **It also records what it asked**, `requestHistory`'s reason exactly: `system_prompt` names no
conversation at all, so this method is the sole place "which conversation does this reply describe"
exists — recorded in a new `pendingSystemPromptRequests: Map<number, string>` after a successful send
and matched back by the reply's `Envelope.in_reply_to`. Routed by conversation through `router.route`
in `src/main/index.ts`'s dispatch case, exactly like `requestModelList`/`requestHistory`. **The sharpest
divergence from every method above it: this verb has no error frame at all.** Every unresolvable case
comes back as an ordinary `no_session` reading, so nothing retries or blocks on the reply, and — unlike
`requestHistory`, whose unroutable id at least draws a client-visible refusal via `daemon-error` — an id
this client cannot route must be refused **before the send**, at the routing lookup, because an empty
or unroutable id on the wire would draw a false "no prompt, no session" reply the correlation map could
not tell from a true one. `connectionRegistry.ts`'s `viewOf` gained one delegate line, the same
tsc-only break shape as #1165's/#1217's/#1222's additions. Ships with no renderer sender and no render
consumer — #1231 fires the ask and stores the reply, #1078 renders it; all four exhaustive bridges take
a dormant no-op arm. See [System prompt send](system-prompt-send.md) for the full contract.

## Modal answers and cancellation

`answerModal(payload: Omit<ModalAnswerPayload, 'answer_token'>)` receives the
[validated answer command](command-channel.md#modal-answer-validation). It builds
a fresh payload containing `modal_id`, `option_id`, a main-minted `answer_token`
(`randomUUID()` through the `mintToken` seam), and `always_allow` only when that key
is present. Both true and false reach `modal_answer` unchanged; omission stays
absent. False or absence requests no additional permission. An authorized allow
with true asks the daemon to apply only its retained offered rules to the session.

`buildModalAnswer` serializes the supplied payload verbatim, so widening the wire
type alone cannot carry a new field through this sender. Keep the named-field
rebuild: renderer-supplied tokens, rules, destinations, conversation IDs and other
extras are discarded. The [inbound offer and reason](inbound-message-decode.md#optional-permission-context)
are display context, never fields to echo as grant authority.

The composition root routes by `modal_id` through `routeModal`, using ownership
recorded from trusted host-stamped modal events. Renderer destinations cannot
reroute an answer. Successful sends enter `outstandingAnswers`; build/send failures
leave no pending entry. Dismissal drains that modal, a rejection uses the existing
FIFO, and redial clears it; see [request correlation and diagnostics](daemon-connection-correlation.md).
`cancelModal` still sends only `{ modal_id }`, with no token or grant Boolean.
Both methods return without sending when no driver is available and retain static,
content-free lifecycle/failure diagnostics.

The permission-contract tests in `daemonConnection.test.ts` feed raw commands
through `onCommand` and decode the fake driver's output. Exact payload checks cover
true, false and absence, minted tokens and forged extras; two-host routing,
rejection correlation and cancellation run through the same path. A builder-only
test would pass even if main silently omitted `always_allow`.
