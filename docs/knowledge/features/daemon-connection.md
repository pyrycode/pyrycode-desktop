# Daemon connection

The **background-process transport consumer** — the wiring slice that finally ties the whole transport chain to the renderer. The [Noise relay driver](noise-relay-driver.md) heals a relay connection and runs a fresh `Noise_IK` handshake on every connect, but it takes the device keys and the `hello` early-data **injected from above** and emits its lifecycle through a plain in-process callback; its own doc names the missing piece: *"the sink is a plain in-process callback owned by a **later** background-process consumer."* **This is that consumer.** It sources the inputs, constructs and drives the driver, and maps the driver's four lifecycle events onto the typed [daemon-event channel](daemon-event-channel.md), so a completed handshake becomes a `connected{ack}` event the [renderer bridge/store](daemon-event-bridge.md) turns into a live-session status the window reads.

Introduced in [#62](../codebase/62.md). This is **composition, not new crypto** — everything it drives is already loadable: the [device-keypair store](device-keypair.md) `ensure()`, the [paired-server store](paired-server-store.md) `load()`, the [hello exchange](hello-exchange.md) `buildClientHello`/`parseHelloAck`, the relay driver, and `emitDaemonEvent`. It is the first end-to-end path in the app: pair → open the encrypted session → surface a completed handshake.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Lifecycle](daemon-connection-lifecycle.md) — When the connection is dialled, torn down and redialled, how it works internally, and the state and concurrency model that holds it together.
- [Request correlation and diagnostics](daemon-connection-correlation.md) — How a reply is matched back to the request that asked for it, one section per correlated round trip, plus the diagnostic logging around them.

## Where it lives (and why not under `transport/`)

`src/main/daemonConnection.ts` — top-level `src/main/`, **not** `src/main/transport/`. This is the composition/wiring layer *above* transport: it imports the driver (`src/main/transport/`) **and** `emitDaemonEvent` + `DaemonEvent` (the IPC layer). The `transport/` directory is deliberately **IPC-free** — no transport module references `emitDaemonEvent` or `DaemonEvent` ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). So the consumer that bridges the two must live one level up to preserve that boundary. It is main-process only — it transitively imports `codec.ts` (Node `Buffer`) and holds the token/keys, none of which may reach the renderer bundle.

## What it does

Gives the composition root **one factory** — `createDaemonConnection(deps): DaemonConnection` — with an idempotent `start()` / `stop()`:

- **`start()`** emits `connecting` **synchronously** (before any `await`), then kicks off an async bootstrap that sources the paired-server record, the device static key, and the server key, builds the `hello`, and constructs the driver (which dials on construction). The boot-time connect, fired once on `did-finish-load`.
- **`reconnect()`** ([#82](../codebase/82.md)) re-arms the once-only lifecycle: it tears down any live driver and dials fresh, re-sourcing the paired-server record at dial time — the **connect-on-pair** trigger, so a pairing made mid-session dials with no restart. See § Connect-on-pair below.
- **The per-dial provider `loadDialConfig`** ([#83](../codebase/83.md)) is *constructed here* (this module owns the store) and **injected into the driver**, so the supervisor's own **automatic** transient-drop reconnect also re-sources the record — for both the connection headers and the Noise session material. See § Reload-per-dial below.
- **On the driver's `handshake-complete{helloAck}`**, it parses the ack via `parseHelloAck` and emits a typed `connected{ack: HelloAckPayload}` on the daemon-event channel — the load-bearing "live, authenticated link" signal.
- **On the driver's `message{plaintext}`**, it decodes the app-envelope via [`parseInboundMessage`](inbound-message-decode.md) and emits `messageReceived{message}` (a `message` envelope) or `messagesReceived{messages}` (a `message_chunk` batch) — the streamed assistant replies. Malformed/oversized/mistyped bytes are dropped without an event; an unmodeled envelope type is ignored. **Added in [#68](../codebase/68.md).**
- **Every non-clean outcome** — no paired record, a malformed record, a bad/wrong-length server key, a rejected keychain read, a malformed `hello_ack`, a driver `error`, or a fatal `terminal` — surfaces as a `failed{error}` event with a **static category code**, never a crash or an unhandled rejection.
- **`stop()`** tears the driver down idempotently and **suppresses** the clean-stop `terminal` (the window is going away on quit, so there is nothing to report).
- **On the driver's `relay-link-up`/`relay-link-down{code}`** ([#328](../codebase/328.md)), it emits a `relayLinkChanged{status}` event carrying the relay-**socket** leg — distinct from the combined session status above. This is the single point that classifies the relay-controlled raw close `code` into the closed `RelayLinkStatus` enum (`connected`/`offline`/`daemon-absent`, `4404` → `daemon-absent`); the code itself never crosses IPC. Ships **dormant** (see the driver-event mapping table below).

### Public surface

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
`null` = "let the daemon choose"). Also the **`send` twin, not a consumer-failing twin** — inert
no-op when `driver === null`, shares the one `nextEnvelopeId` counter, never throws (parity #490).
Unlike `requestSnapshot`/`requestConversations`, it builds a **fresh literal** naming exactly the
three modeled fields (`{ is_promoted: payload.is_promoted, name: payload.name, cwd: payload.cwd }`)
before calling `buildCreateConversation` — never a spread of the caller's `payload` — the
deterministic net that bounds the outbound wire to exactly those three fields regardless of what the
structural-minimum `isCreateConversationPayload` guard let through (the [#236](../codebase/236.md)
fresh-literal posture, reused here for the first `send`-family method carrying more than one field).
The reply is routed through the same `case 'message'` seam as a new `case 'conversation-created':`,
emitting `conversationCreated` as a verbatim passthrough — nothing to drop, like `conversations`. Its
caller is the render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242), blocked
on this ticket. See the [conversation create](conversation-create.md) feature doc for the full
contract.

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

**`answerQuestions(payload)`/`refuseQuestions(payload)` were added in
[#920](https://github.com/pyrycode/pyrycode-desktop/issues/920)** — the resolution half of the question
vertical, one dial after [#919](https://github.com/pyrycode/pyrycode-desktop/issues/919) landed the
builders with no caller. Both are **`send` twins, not `answerModal`'s consumer-failing twin**: a
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

## Edge cases and limitations

- **Two explicit connects + the automatic reconnect all re-source the record.** The boot-time connect fires once on `did-finish-load`; `reconnect()` ([#82](../codebase/82.md)) re-arms on a fresh mid-session pairing (see § Connect-on-pair); and the supervisor's own **automatic** transient-drop reconnect now re-reads the record too via the injected `loadDialConfig` provider ([#83](../codebase/83.md), see § Reload-per-dial). No stale pre-pairing view survives in memory across any dial.
- **The inbound `message` arm decodes and emits ([#68](../codebase/68.md)).** `message{plaintext}` is narrowed by [`parseInboundMessage`](inbound-message-decode.md) into `messageReceived` / `messagesReceived`, failing closed on hostile bytes. The renderer *render* of those events (thread render-binding) is [#69](https://github.com/pyrycode/pyrycode-desktop/issues/69); this module only produces them.
- **A missed early `connecting` is benign.** The store's initial state is already `disconnected`, so if the synchronous `connecting` marginally precedes the renderer's bridge subscription, only a brief moment of the send control staying disabled for the wrong reason is skipped; the load-bearing `connected` arrives after a network round-trip and is safe. (Through [#968](../codebase/968.md) the composer also rendered a "Connecting…" caption on this arm, so the miss used to skip a visible flash of that text too; the caption is retired and `disconnected`/`connecting` now render identically in the composer.) Full status-sync-on-mount is [#34](https://github.com/pyrycode/pyrycode-desktop/issues/34)/[#35](https://github.com/pyrycode/pyrycode-desktop/issues/35).
- **macOS re-activation.** `app.on('activate')` re-creates a window without re-wiring the connection (the sink still points at the destroyed `webContents`). Single-window is the milestone assumption; multi-window / re-activation lifecycle is deferred (pre-existing in `createWindow`'s `activate` handler, not introduced here).
- **Reusing the same `hello` across reconnects is safe.** This consumer injects a fixed key/`hello` set once; the driver's fresh-handshake-per-connect invariant means no `(key, nonce)` is ever reused. Noise provides per-handshake freshness and v2 does not replay-check the hello `ts`.
- **`serverId` is `null` only for the registry's not-paired stand-in; every real connection carries its own record's `server` (#1117).** The composition root no longer constructs a `DaemonConnection` directly — it builds a [connection registry](daemon-connection-lifecycle.md#the-connection-registry-1117) and holds `registry.active`, a stand-in that delegates to whichever connection the registry currently holds. The registry mints `serverId` once per stored record, from `record.server`, and uses that same value both to stamp the connection and to key the per-server store view it hands the connection as `pairedServer` — so the two can never drift apart (a connection presenting one server's token against another's static key is the failure this exists to rule out). `null` survives only for the stand-in the registry builds when nothing is paired, over the *whole* store rather than a per-server view — byte-for-byte the single connection this module's composition root used to build. The `serverId` dependency was already **required, not optional** (#1068), precisely so the registry cannot build a connection that forgets its own identity.

## Related

- [The connection registry](daemon-connection-lifecycle.md#the-connection-registry-1117) / #1117 — the composition root's actual caller since this module stopped being constructed directly at the root: one registry, one connection per stored paired record, reconciled against the store on every pairing/unpair signal.
- [Live window](live-window.md) / [#519](../codebase/519.md) — the composition root's `sink: live.sink`
  and the `openWindow()` load handler's `live.replayStatus()` call, which converges a dock-reopened
  window on this module's connection status by re-delivering its last-seen status event. No changes
  to this file; `start()`'s pre-existing idempotence (line 149 above) is what the replay-then-start
  pairing relies on.
- [#396 codebase notes](../codebase/396.md) — the `pendingCreateFolders` correlation set (see §
  Create-workspace-folder rejected correlation above), the new `workspaceFolderRejected` emit inserted
  into the existing `case 'daemon-error':` precedence gate alongside `pendingSettings`, and the `dial()`
  reset. No new method on this factory — `createWorkspaceFolder` (#381) is unchanged besides the
  pending-add after send.
- [#62 codebase notes](../codebase/62.md) — implementation summary, patterns, lessons.
- [Daemon-event channel plumbing](daemon-event-channel-plumbing.md) — `bindServerOrigin`, the stamping
  sink `createDaemonConnection` binds from `deps.serverId`, and why all 39 `emitDaemonEvent(sink, …)`
  call sites in this module stay origin-free by construction (#1068).
- [#504 codebase notes](../codebase/504.md) / [Unpair channel](unpair-channel.md) — teardown-on-unpair: `reconnect()`'s second caller, wired from the unpair handler's new `onUnpaired` trigger. Zero changes to this file — the existing generation fence and driver-stop already covered it.
- [#82 codebase notes](../codebase/82.md) / [Pairing IPC channel](pairing-ipc-channel.md) / [#54](../codebase/54.md) — connect-on-pair: the `reconnect()` re-arm + generation fence added here, fired by the pairing handler's `onPaired` trigger a confirm-success wires to `connection.reconnect()`.
- [#83 codebase notes](../codebase/83.md) — reload-per-dial: the `loadDialConfig` provider constructed here and threaded to the driver so the supervisor's *automatic* reconnect re-sources the record too (see § Reload-per-dial).
- [Content-free diagnostic log](diagnostic-log.md) / [#126](../codebase/126.md) + [#128 codebase notes](../codebase/128.md) — the injected logger this module is the daemon-leg consumer of; the three log sites (`daemon-dial`/`daemon-connected`/`daemon-failed`) added at pre-existing seams (see § Diagnostic logging). Complementary to [#127](../codebase/127.md)'s relay leg — this leg logs the classification, that leg logs the socket coordinates + close code.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the `send(payload)` entry point added to this factory, the `buildSendMessage` envelope builder it drives, and the composition-root `onCommand` registration that routes a `sendMessage` command to it.
- [Debug-bundle request](debug-bundle-request.md) / [#115](../codebase/115.md) — the `requestDebugBundle()` method added to this factory (a structural twin of `send` sharing the same `nextEnvelopeId` counter), and the bare `request_debug_bundle` control-frame builder it drives.
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) / [#169](../codebase/169.md) — the composition-root consumer that calls `requestDebugBundle(consumer)` from the `onCommand` switch.
- [Attachment transfer](attachment-transfer.md) / [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861) — the `uploadAttachment(input)` method added to this factory, the `activeTransfers` Set + `failAttachmentTransfers()` teardown net + the two new inbound correlation arms it added here, and the `AttachmentTransfer` state machine it drives.
- [Attachment retrieval](attachment-retrieval.md) / [#996](https://github.com/pyrycode/pyrycode-desktop/issues/996) — the `requestAttachment(payload, consumer)` method added to this factory, the `pendingRetrievals` Map + `failAttachmentRetrievals()` teardown net + the idle-deadline timer + the two new inbound correlation arms (`attachment-chunk`, the retrieval leg of `daemon-error`) it added here, composing #995's reassembler.
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the `requestSnapshot(payload)` method added to this factory (the `send` twin, not `requestDebugBundle`'s consumer-failing twin) and the payload-carrying `buildRequestSnapshot` builder it drove, both removed by [#620](../codebase/620.md); the `case 'message'` consumer's content-minimisation emit removed by [#621](../codebase/621.md); the `snapshot` inbound kind and its decode removed by [#622](../codebase/622.md) — no piece of this feature survives on this factory today.
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the `requestConversations()` method added to this factory (another `send` twin, but bare like `requestDebugBundle`'s builder), the `buildListConversations` builder it drives, and the `conversations` inbound kind + verbatim (no-drop) emit in the `case 'message'` consumer arm.
- [Run configuration store](run-config-store.md) / [#491](https://github.com/pyrycode/pyrycode-desktop/issues/491), widened [#945](https://github.com/pyrycode/pyrycode-desktop/issues/945) — the `requestSessionSettings(conversationId?)` method added to this factory, the conversation-keying correction that gave the signature a real parameter, and [#946](https://github.com/pyrycode/pyrycode-desktop/issues/946), which made the sole caller actually pass one.
- [Conversation timeline store](conversation-timeline-store.md) / [#214](../codebase/214.md) — the `turn-state` inbound kind + the new `case 'turn-state'` consumer emit (`conversation_id` dropped, `state` carried), feeding the timeline bridge's `phase`. No new method on this factory — `turn_state` is inbound-only, unlike `requestSnapshot`/`requestConversations`.
- [#315 codebase notes](../codebase/315.md) — the `stall` inbound kind + the new `case 'stall'` consumer emit, at ship time a fresh **nullary** `{ type: 'stallDetected' }` literal (`conversation_id`, the payload's only field, was dropped — nothing else to carry). Not `assertNever`-guarded in this inner switch; the round-trip test is the guard. No new method on this factory — `stall` is inbound-only, and onset-only (no request/reply pair, no clearing frame). [#732 codebase notes](../codebase/732.md) — widened the emit to carry `conversationId`, copied by name from the decoded payload, replacing the arm's "nullary ⇒ nothing can ride it" doc claim with the daemon-asserted-routing-key argument #724 established for `turnState`.
- [#492 codebase notes](../codebase/492.md) — the `api-retry` inbound kind + the new `case 'api-retry'` consumer emit, a fresh **non-nullary** `{ type: 'apiRetry', active, current, total }` literal copied by name from the already-decoded payload (never a spread) — `conversation_id` dropped, the only field this arm does drop. Unlike `stall`, NOT onset-only and NOT deduped: the dispatch is stateless per frame, so N daemon frames (including a repeated rising edge as the count climbs) produce N events. Not `assertNever`-guarded in this inner switch; the round-trip test is the guard. No new method on this factory — `api_retry` is inbound-only. Ships dormant; the render slice #493 is the first consumer.
- [#495 codebase notes](../codebase/495.md) — the `compacting` inbound kind + the new `case 'compacting'` consumer emit, a fresh **non-nullary** `{ type: 'compacting', active: inbound.compacting.active }` literal copied by name (never a spread) — `conversation_id` dropped, the only field this arm drops. `apiRetry`'s peer but **banner-only**: no counter on the wire at all, so the arm carries exactly one bool, the smallest non-nullary status-liveness shape in this file. NOT onset-only and NOT deduped, same as `api-retry`. Not `assertNever`-guarded in this inner switch; the round-trip test is the guard. No new method on this factory — `compacting` is inbound-only. Ships dormant; the render slice #496 is the first consumer.
- [Conversation timeline store](conversation-timeline-store.md) / [#217](../codebase/217.md) — the `tool-use` inbound kind + the new `case 'tool-use'` consumer emit (`conversation_id` dropped, `turnId`/`toolUseId`/`name`/`inputSummary` carried), feeding the timeline bridge's fourth owned arm — the first to drive a durable `toolCall` item. No new method on this factory — `tool_use` is inbound-only.
- [Modal-prompt model](modal-prompt-model.md) / [#201](../codebase/201.md) — the `modal-shown`/`modal-dismissed` inbound kinds + the two new consumer emit cases; at ship time the first pair in this stream to drop no `conversation_id`, because the wire carried none on a modal. Consumed by neither existing bridge — the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md). No new method on this factory — both kinds are inbound-only. **[#870](../codebase/870.md)** mirrored the daemon's new `ModalShownPayload.conversation_id` (pyrycode#1065) into the decoded payload, but the `modal-shown` emit here still built a fresh named-field literal that omitted it — a deliberate, not accidental, drop; the comment at the call site said so. **[#871](../codebase/871.md)** carried it the rest of the way: the emit now copies `conversationId: inbound.modalShown.conversation_id` onto the same fresh literal, by name, read bare (the decode already requires it, so no `?? ''` fallback). It is the tenth arm in the `#675` routing-key family (after `turnState`/`stallDetected`/`apiRetry`/`compacting`/`assistantDelta`/`turnEnd`/`toolUse`/`toolResult`/`unrecognizedMessage`) and, like the rest of that family, an outbound scoping key only — `modalId` remains the sole correlation key for *answering* a prompt. It ships dormant: the modal store + bridge's `translateModalEvent` rebuilds a fresh `ModalEvent` and still omits it; [#872](../codebase/872.md) is the consumer. `modal-dismissed`'s emit is unaffected and still carries no `conversation_id`.
- [Conversation timeline store](conversation-timeline-store.md) / [#229](../codebase/229.md) — the `tool-result` inbound kind + the new `case 'tool-result'` consumer emit (`conversation_id` dropped, `turnId`/`toolUseId`/`isError`/`resultSummary` carried), feeding the timeline bridge's fifth owned arm — the first to **resolve** an existing `toolCall` item's `result` rather than append a new item. The vertical's last transport slice. No new method on this factory — `tool_result` is inbound-only.
- [Conversation create](conversation-create.md) / [#241](../codebase/241.md) — the `createConversation(payload)` method added to this factory (the write-side twin of `requestConversations`, with a fresh-literal security net bounding the outbound wire to exactly three fields), the payload-carrying `buildCreateConversation` builder it drives, and the `conversation-created` inbound kind + verbatim (no-drop) emit in the `case 'message'` consumer arm.
- [#254 codebase notes](../codebase/254.md) — the `session-transition` inbound kind + the new `case 'session-transition'` consumer emit (a fresh literal carrying only `newSessionId`, the #180 content-drop model's second application). No new method on this factory — `session_transition` is inbound-only, daemon-initiated.
- [Session settings send](session-settings-send.md) / [#263](../codebase/263.md) — the `setSessionSettings(payload, changeId)` method added to this factory (a faithful `requestSnapshot` twin whose builder owns the omitempty presence contract; `changeId` + `pendingSettings` added by #261), the payload-carrying `buildSetSessionSettings` builder it drives, and the dormant status pending #256's render consumer.
- [#264 codebase notes](../codebase/264.md) — the `session-settings-updated` inbound kind + the original unconditional `case 'session-settings-updated'` consumer emit, since rewritten correlation-gated by #261 (see § Set-session-settings confirmed-round-trip correlation above).
- [#261 codebase notes](../codebase/261.md) — the `pendingSettings` correlation map, the rewritten `case 'session-settings-updated'`, and the `dial()` reset (see § Set-session-settings confirmed-round-trip correlation above). No new method on this factory — widens `setSessionSettings`'s signature and rewrites one existing case.
- [#269 codebase notes](../codebase/269.md) — the rewritten `case 'daemon-error':` precedence gate (see § Set-session-settings rejected correlation above): correlates against the same `pendingSettings` map first, closing the orphan #261 left open, and skips both the reassembler `fail` and the #248 modal FIFO `shift` on a match. No new method on this factory — rewrites one existing case.
- [#248 codebase notes](../codebase/248.md) — the `outstandingAnswers` FIFO correlation window added to this factory (see § Modal-answer rejection correlation above), the new `modalAnswerRejected` emit from the existing `case 'daemon-error':` arm, and the drain hooked into the existing `case 'modal-dismissed':` arm. No new method on this factory — the correlation rides the two pre-existing `answerModal`/inbound-message seams.
- [Question resolution envelope](question-resolution-envelope.md) / [#920](https://github.com/pyrycode/pyrycode-desktop/issues/920) — the `answerQuestions(payload)`/`refuseQuestions(payload)` methods added to this factory (both `send` twins that mint `answer_token` main-side, unlike the modal pair where only the answer half mints), the two builders they drive, and the deliberate absence of a correlation window (the daemon emits nothing for a rejected question answer). [Command channel](command-channel.md) is the `RendererCommand` pair + guards that route here.
- [#564 codebase notes](../codebase/564.md) — the `background-task-started` inbound kind + the new `case 'background-task-started'` consumer emit, a fresh **non-nullary** six-field literal copied by name (never a spread). The one arm in this switch that **keeps** `conversation_id` instead of dropping it — the frame carries no `turn_id` and opens/closes no turn, so it is daemon state (the `queueState` #720 rule), not a turn-stream item. Not `assertNever`-guarded in this inner switch; the round-trip test is the guard. No new method on this factory — `background_task_started` is inbound-only. Ships dormant; [the roster store (#573)](../codebase/573.md) consumes only the `background_task_roster` arm below, not this one — this arm stays dormant, awaiting #574. First of three sibling frame slices (#565/#566 follow).
- [#565 codebase notes](../codebase/565.md) — the `background-task-updated` inbound kind + the new `case 'background-task-updated'` consumer emit, a fresh **non-nullary** four-field literal copied by name (never a spread) — the subset twin of the arm above, `conversation_id` likewise **kept**. Deliberately performs **no join** against `backgroundTaskStarted`: ordering is claude's, not the daemon's, so an update for a task this connection never saw opened still emits rather than buffering. Not `assertNever`-guarded in this inner switch; the round-trip test is the guard. No new method on this factory — `background_task_updated` is inbound-only. Ships dormant; [the roster store (#573)](../codebase/573.md) consumes only the `background_task_roster` arm below, not this one — this arm stays dormant, awaiting #574. Second of three sibling frame slices (#566 follows).
- [#566 codebase notes](../codebase/566.md) — the `background-task-roster` inbound kind + the new `case 'background-task-roster'` consumer emit, a fresh **non-nullary** three-field literal copied by name (never a spread) — the **aggregate peer** of the two arms above, `conversation_id` likewise **kept**. `tasks` passes the already-narrowed row array through **by reference**, snake_case (the `queue-state` nested-array precedent, no per-row re-literal). Deliberately stateless in a *different* way from the arm above: that one tempted a join, this one tempts a **diff** — the family has no terminal event, so holding the previous roster to compute what disappeared looks like the obvious next step and is explicitly forbidden here (the only mutable state the leg would gain, keyed by an attacker-influenceable `task_id`); an empty roster following a non-empty one still emits rather than being suppressed. Not `assertNever`-guarded in this inner switch; the round-trip test is the guard. No new method on this factory — `background_task_roster` is inbound-only. Ships dormant no longer: [the background-task-roster store (#573, shipped)](../codebase/573.md) is the first consumer, holding the `tasks`/`droppedTasks` rows verbatim by reference, keyed by `conversationId`. Third and last of the sibling frame slices.
- [#587 codebase notes](../codebase/587.md) — the `model-announced` inbound kind + the new `case
  'model-announced':` consumer emit, a fresh **non-nullary** two-field literal `{ type: 'modelAnnounced',
  model, truncated }` copied by name (never a spread) — `conversation_id` dropped, the only field this
  arm drops. Unlike the background-task family this frame is an **identity report**, not daemon state
  keyed by conversation, so it drops `conversation_id` rather than keeping it — the `turnState`/
  `stallDetected`/`apiRetry`/`compacting` convention, not the `queueState`/background-task one.
  Deliberately stateless, same as `apiRetry`/`compacting`: no dedup, so a verbatim repeat still produces
  an event. Not `assertNever`-guarded in this inner switch; the round-trip test is the guard. No new
  method on this factory — `model_announced` is inbound-only. Ships dormant no longer: [the
  announced-model store (#588, shipped)](announced-model-store.md) is the first consumer,
  still dormant pending #560's render surface.
- [#642 codebase notes](../codebase/642.md) — the `tool-use` `case` arm widened by one field: `input: inbound.toolUse.input` added to the existing fresh literal, unconditional (`undefined` when the wire omitted it). Crosses **by reference** to the already-narrowed fresh map `parseToolUsePayload` built — no second copy, since the reserved-key strip already happened at decode. Ships dormant; #643 is the first consumer. No new method on this factory — the sixth `tool_use` field is inbound-only, like the five it joins.
- [#328 codebase notes](../codebase/328.md) / [Relay supervisor](relay-supervisor.md) / [Noise relay driver](noise-relay-driver.md) — the `relay-link-up`/`relay-link-down{code}` driver events + the two new `onDriverEvent` cases that classify the raw close code into the renderer-facing `relayLinkChanged{status}` `DaemonEvent` (the relay-**socket** leg, distinct from this module's own session-level `connecting`/`connected`/`failed`). Ships dormant; first of three slices toward a two-dot connection-status indicator.
- [Inbound message decode](inbound-message-decode.md) / [#68](../codebase/68.md) — `parseInboundMessage`, the transport-layer decoder the `case 'message'` arm calls; it owns the wire boundary (size guard, `decodeEnvelope`, per-field narrowing) so this arm stays a thin IPC map.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — the driver this constructs and drives; it named this consumer as its missing piece. Owns the reconnect loop / fresh-handshake-per-connect / fatal-code classification this module does **not**.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `buildClientHello` builds the injected `session.hello`; `parseHelloAck` narrows the `handshake-complete{helloAck}` bytes into the `HelloAckPayload` this emits.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — `ensure()` sources the static private key.
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — `load()` sources the `{server, relay, token, server_static_pubkey}` record.
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — `emitDaemonEvent` + the `DaemonEvent` union this emits onto.
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) + [Session store](session-store.md) / [#2](../codebase/2.md) — the renderer half that turns `connected{ack}` into a completed-handshake state; this module produces the event that feeds them.
- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the secret-at-rest chain the reused stores sit on.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay, transport isolated in the background process; the wire types match mobile field-for-field.
