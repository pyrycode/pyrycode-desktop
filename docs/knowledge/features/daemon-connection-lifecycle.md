# Daemon connection — lifecycle

When the connection is dialled, torn down and redialled, how it works internally, and the state and concurrency model that holds it together.

Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links.

# Connect-on-pair (`reconnect()`, [#82](../codebase/82.md))

`reconnect()` was added so a pairing made **during a running session** dials with no manual step
(mirrors mobile #489). Before it, `start()` was once-only (`if (started || stopped) return`); a
client that paired mid-session persisted the record but never connected until the next launch.
The [pairing handler](pairing-ipc-channel.md) fires its value-free `onPaired` callback after a
confirm persists. The composition root now routes that signal through
[`registry.reconcile()`](daemon-connection-registry.md): new records create connections, changed
records reconnect their held connection, and identical records leave it untouched. An explicit
named-host reconnect can re-dial an unchanged pairing through the separate entry point below.

**`start()` and `reconnect()` both funnel through a private `dial()`** — the single fresh-connect path. `dial()`:

1. `++generation` — bump the connection fence (see below), superseding any prior dial.
2. `driver?.stop()` then `driver = null` — tear down any live driver before dialing the next, so two sockets never stack and only the fresh server is dialed (**AC3**). The old driver's stop-terminal carries the *old* gen, so the per-dial `onEvent` wrapper drops it — no spurious `failed`. Null before the first dial (or after a not-paired boot), where this is a no-op.
3. `nextEnvelopeId = 2` — fresh session, fresh app-envelope numbering (each dial rebuilds `hello` at id 1). Correctness-neutral (the daemon correlates by `id`, not sequence) but keeps a re-dialed session self-consistent.
4. `emitDaemonEvent(sink, { type: 'connecting' })` — synchronous, before any `await` (**AC2**).
5. `void bootstrap(gen)` — fire-and-forget; `bootstrap` catches everything and never rejects.

`start()` keeps its `if (started || stopped) return` guard, sets `started = true`, then calls `dial()` — **behaviour-preserving** on first start (driver is null, `nextEnvelopeId` already 2). `reconnect()` is `if (stopped) return`, sets `started = true` (idempotent — keeps a later `did-finish-load` start a no-op in the unreachable race), then `dial()`. **`reconnect()` re-sources the record fresh** because `bootstrap` runs `await pairedServer.load()` when the connect *begins*, not at construction — so the just-persisted pairing's relay/server/token/key are the ones dialed (**AC3**), with **no record-reload plumbing** added here.

## The generation fence

`reconnect()` copies the [Noise relay driver](noise-relay-driver.md)'s own `generation`-counter idiom (`noiseRelayDriver.ts:100-118`) **one layer up**. A module-local `let generation = 0`, bumped in `dial()`, plus a per-dial wrapper around the `onEvent` passed to `createDriver` — a closure capturing the dial's `gen` that early-returns when `gen !== generation`, else forwards to the unchanged `onDriverEvent`. `bootstrap(gen)` threads the same `gen` and fences at each suspension point:

- after `await pairedServer.load()` and `await deviceKeypair.ensure()`, `loadDialConfig` checks `stopped` and its captured generation before changing the pairing snapshot or building a hello. A cancelled load returns `null`; `bootstrap` checks both fences before treating that result as an absent pairing.
- before `createDriver`: `if (stopped || gen !== generation) return` — covers app-quit (**`stopped`**, which `generation` does NOT subsume) **and** supersession. `stopped` is checked explicitly because `stop()` does not bump `generation`.
- `catch`: `if (gen === generation) emitFailed('connect-failed')` — a superseded bootstrap's throw is silent (its `failed` would clobber the successor's `connecting`).

**`stopped` and `generation` are two orthogonal fences.** `stopped` fences **permanent** teardown (`stop()` on app quit); `generation` fences **reconnect supersession**. `stop()` deliberately does not bump `generation`, so the app-quit terminal is still suppressed by `onDriverEvent`'s `if (stopped) return` (the wrapper passes it through — gen unchanged on stop). One fence resolves all three reconnect races: (1) the old driver's stop-terminal after a reconnect → wrapper drops it (old gen); (2) a reconnect superseding an in-flight `bootstrap` mid-`await` → guards abort the stale bootstrap; (3) rapid double reconnect → each `++generation` supersedes; last dial wins.

**`generation` also gets bumped from outside `dial()` (#1613).** The app-too-old halt in `onDriverEvent`'s sealed-`client.update_required` arm calls `generation++` directly, with no matching `dial()` call — a fourth use the three races above don't cover: a deliberate, one-shot **stop without a successor**. The stopped driver's own `terminal` and the relay's following `4412` close both carry the now-superseded generation and are dropped by the same `onEvent` wrapper, so the halt reuses the fence purely for its drop-stale-events effect, not for its reconnect-supersession one. See [Daemon connection § App-too-old rejection](daemon-connection.md#app-too-old-rejection-update-required-1613).

## Data flow (connect-on-pair)

```
renderer confirm invoke ─▶ pairingHandler.listener
                             await confirm()  ─▶ store.save(snapshot)   (record persisted)
                             onPaired()       ─▶ registry.reconcile()
                                                 changed held record ─▶ connection.reconnect()
                                                   dial(): ++gen, driver?.stop() (old terminal fenced),
                                                           emit {connecting}, bootstrap(gen)
                                                   bootstrap: load() (fresh record) ─▶ createDriver
                                                   handshake ─▶ {connected} | {failed}
                             return { ok: true }   (independent reply channel — carries no secret)
```

The confirm reply (fingerprint/ok channel) and the daemon `connecting`/`connected` events are independent — the renderer already renders the latter (the [daemon-event bridge](daemon-event-bridge.md), [#19](../codebase/19.md)), so **no renderer change** (AC2). A failed persist takes the handler's `catch` → `persist-failed` reply, `onPaired` is never reached, no dial (**AC4**). `onPaired` carries no arguments, so no record field crosses (**AC5** by construction).

# Teardown-on-unpair (`reconnect()`, [#504](../codebase/504.md))

Before the per-server registry, the [unpair channel](unpair-channel.md) wired
`onUnpaired: () => connection.reconnect()` at the composition root, mirroring the pairing handler.
Current wiring uses `registry.reconcile()` for both signals: an unpair stops and drops only the
removed host's connection, with a new null-id stand-in when the last record disappears. The earlier
single-connection implementation relied on the following existing `reconnect()` behavior:

1. `dial()`'s first statement, `++generation`, fences every event the *superseded* driver emits from
   this instant onward — `connected`, `messageReceived`, `messagesReceived`, `assistantDelta`,
   `turnState`, `toolUse`, `toolResult` are all dropped upstream of any decode, at the same `onEvent`
   wrapper the connect-on-pair fence already installs.
2. `driver?.stop(); driver = null` closes the relay socket — the authenticated session ends, it is not
   merely muted.
3. `bootstrap`'s null-record branch (the store was just cleared) emits `failed('not-paired')` and
   returns **before** `createDriver` — no replacement driver, no dial.
4. `dial()` never touches `stopped` — only `stop()` does — so a later re-pair's `onPaired → reconnect()`
   call is unaffected; teardown-then-re-pair connects exactly as before.

The renderer sees a transient `connecting` then `failed{not-paired}` (accepted consequence — the route
already flipped to the pairing screen by the time these arrive, and `appRoute.ts` derives the launch
route from pairing status, never session status). This is why `reconnect()` reads as "re-dial from
disk," not "disconnect": every caller — connect-on-pair, reload-per-dial's automatic reconnect, and now
teardown-on-unpair — converges on the same "connect to whatever the store holds right now, or
`not-paired` if it holds nothing" behaviour, which is also what makes a concurrent unpair/re-pair
interleaving race-safe by construction (no interleaving needs its own handling).

# Reload-per-dial (`loadDialConfig`, [#82]/[#83])

`reconnect()` re-sources the record on an **explicit** re-arm ([#82](../codebase/82.md)), but it deliberately left the [supervisor](relay-supervisor.md)'s *own* **automatic** transient-drop reconnect reusing the config snapshotted at construction — in **two** layers: the supervisor's captured `connection` (url + headers) and the driver's captured `session` (`server_static_pubkey` + `hello`). [#83](../codebase/83.md) closes that gap by extracting `bootstrap`'s inline record-load + derive (see § How it works) into a **provider** this module constructs and injects.

- **`loadDialConfig(): Promise<DialConfig | null>`** is the extracted record-load + derive — `await pairedServer.load()` → `null` (no record) or the assembled `{ connection, session }`. It is store-owning code (`pairedServer` lives here, above transport), so constructing it here and passing a plain async function down keeps the driver/supervisor **store-agnostic and IPC-free**.
- It is threaded to the driver (`createDriver({ …, loadDialConfig })`), which wraps it in a `resolveConnection` the supervisor calls before each automatic re-dial: **one `load()` feeds both halves** — the supervisor gets the fresh `connection`, the driver's next `onConnected` gets the fresh `session` — so a re-pair mid-session dials the new relay/server/token/key with no split between headers and key.
- The **first** dial keeps using the config `bootstrap` already loaded (no reason to reload microseconds later, and #82's first-dial not-paired/connect-failed messaging stays put); the provider drives only the automatic re-dials.
- **Fail-closed:** a reconnect that finds no record (`load()` → `null`), or a throw from a malformed record / bad key / keychain failure, ends supervision via the synthetic `NO_PAIRED_RECORD_CLOSE_CODE` → the driver's `terminal` → this module's `failed('connection-closed')` — a non-connected event, never a crash (AC3). The record never leaves the background process (AC5). The full mechanics are in the [relay supervisor](relay-supervisor.md) and [noise relay driver](noise-relay-driver.md) docs; the [#83 codebase note](../codebase/83.md) has the design.

## Replay cursor lifetime

Each host's connection holds a scalar replay cursor and a copied four-field pairing
snapshot in main-process memory for this app run. Initial, automatic-reconnect and
explicit-reconnect hellos send the latest cursor as `last_event_id`, omitting the
key when no position exists. `last_event_id` requests the daemon's bounded retained
tail for its current conversation after a daemon-wide event position. It does not
request history. `last_seen_ts` has no daemon consumer and is never sent by this
connection; the [hello builder](hello-exchange.md) retains only its compatibility
input.

On every dial, compare `server`, `relay`, `token` and `server_static_pubkey` with
the snapshot. Equal values preserve the cursor across redials even when the store
returns a fresh object. Any changed field or an absent record clears it. The
[registry](daemon-connection-registry.md) retains a connection on pairing
replacement, so connection lifetime alone cannot define cursor lifetime. Copy the
named fields rather than retaining the caller's mutable record. Unpair removes
the host's connection; pairing that host again creates an empty cursor. Other
hosts keep their own positions. Nothing persists the cursor or exposes it as a
renderer or log field.

## Disconnected composer message delivery

Each host connection owns a main-memory FIFO of copied `SendMessagePayload` values,
including the original conversation, message ID, text and attachment IDs. Accepted
submissions during initial bootstrap, handshake or reconnect wait here. The existing
offline composer Send gate remains; the FIFO closes the renderer/main disconnect race.
It stores payloads rather than ciphertext and rebuilds envelopes for the current dial.

Admission validates the message and encodes it against `MAX_PLAINTEXT_BYTES`, the
existing per-frame plaintext bound. The FIFO permits at most 128 messages and 1 MiB
of encoded envelope bytes per host. Invalid/oversized payloads and incoming overflow
emit `not-sent`; overflow never evicts an older entry. A synchronous draining guard
keeps reentrant submissions behind the existing remainder. Keep the draining head's
count and bytes reserved until the driver accepts it: removing it before handoff
would admit an extra message if a reentrant submission arrived and the head was refused.

Drain only after `parseHelloAck` validates the authenticated handshake, on automatic
or explicit reconnect as well as initial connect. A synchronous `send-refused`
observation leaves the head in place, marks it waiting and stops draining. A later
successful handshake resumes the never-written remainder in submission order.
Other send failures emit `not-sent` and remove that entry from automatic retry.
An accepted send without an immediate observation belongs to `noiseSession`'s rekey
buffer; main removes it from its FIFO and lets the eventual observation report its
outcome. Holding it in both places would duplicate delivery.

`messageDelivery` IPC carries only conversation/message IDs and the closed status
`waiting | not-sent | written`, with the existing host stamp. Its observer works
independently of `MessageLifecycle.sending`, which may supply no diagnostic observer
and records only one attempt. Local holding does not report a diagnostic drop;
final acceptance/failure or permanent release completes that observation.
`written` means `WebSocket.send` returned, not daemon acknowledgement. Written
messages leave the FIFO permanently; a missing receipt or repeated connected
notification cannot trigger a resend. See [composer delivery and settlement](composer-send-internals.md#2-local-delivery-status-and-receipt-settlement).

Terminal connection failure marks retained echoes `not-sent` while keeping their
payloads. Existing explicit Reconnect changes them back to waiting and retries after
authentication only if the pairing is unchanged. Compare `server`, `relay`, `token`
and `server_static_pubkey` on every dial reload, using the copied replay-pairing
snapshot above. Initial bootstrap adopts the first pairing. Missing or changed
pairing fails and releases the old FIFO; registry removal and connection `stop()`
also fail and release it before driver teardown. Surviving echoes remain Not sent,
and no old payload reaches a replacement pairing. Holds survive thread switches,
but app shutdown releases them; there is no disk outbox or restart delivery.

### Delivery verification

`daemonConnection.test.ts` covers admission limits, initial holding, ordered/reentrant
draining, repeated handshakes, a second refusal, terminal recovery, pairing removal/
replacement/disposal and deferred rekey observations. Store/composer tests cover
synchronous status-before-send, bridge rollback and host-owned inactive echoes.
The mounted `e2e/disconnected-message-delivery.spec.ts` checks fake-daemon decoded
frames and visible waiting/failed rows, running-turn queue correlation, ordered
settlement and replay stability, with automatic, explicit and terminal recovery.

Recorded evidence for #1853 at `cfa9de8b`: verifier gate 6 executed 335 fake-transport
tests, with 335 passed, 0 failed and 4 skipped. The [verifier PASS verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1855#issuecomment-6036469849)
confirms that all three named “accepted disconnected messages drain and settle:
automatic”, “accepted disconnected messages drain and settle: explicit” and
“accepted disconnected messages drain and settle: terminal” scenarios were present
and passed, as did the repaired switch-agent regression. The same verdict records
9,343 unit tests executed/passed, 0 failed and 3 skipped. This client delivery
regression requires no new real-Claude acceptance; these counts establish fake
transport and unit evidence only.

# How it works

## The bootstrap (what `start()` drives)

`start()` returns synchronously but fires a fire-and-forget async bootstrap that never rejects — one `try/catch` wraps the whole thing. Since [#83](../codebase/83.md), the record-load + derive (steps 3–6) is factored into the private `loadDialConfig()` — which `bootstrap` calls as a unit **and** which is threaded to the driver for its automatic reconnects (see § Reload-per-dial):

1. Guard: if already `started` or already `stopped`, no-op (single explicit connect).
2. Emit `{ type: 'connecting' }` **synchronously** via `emitDaemonEvent`, before any `await` (AC3).
3. `const dc = await loadDialConfig()` — load the pairing, ensure the device static keypair, decode the server key as exactly **32 bytes**, compare the replay pairing snapshot, then build a fresh hello with `id: 1`, `ts: now()`, identity, token, `capabilities: ['interactive', 'multi_agent', 'stop_background_task']` and optional `lastEventId`. `lastSeenTs` is omitted. The provider checks stopped/generation fences after both awaits and returns the assembled `{ connection, session }` or `null` for an absent record or cancellation.
4. Check `if (stopped || gen !== generation) return` before the null-result branch. Only a current, active bootstrap interprets `dc === null` as `failed('not-paired')`. A cancelled successful load must emit no post-stop renderer event or diagnostic; checking only for driver construction misses this stale-failure path.
5. If `stopped` or superseded since step 2, return without constructing the driver (`if (stopped || gen !== generation) return` — closes the start/stop and reconnect-supersede races).
6. `createDriver({ connection: dc.connection, session: dc.session, loadDialConfig, onEvent: fenced })` and retain the handle. The driver dials on construction; `loadDialConfig` is threaded so the driver's *automatic* reconnects re-source the record.

## Driver config assembled by `loadDialConfig`

| Config field | Value | Note |
|---|---|---|
| `connection.url` | `record.relay` | verbatim (the relay was scheme/allowlist-validated at pairing, [#52](pairing-payload-gate.md)) |
| `connection.headers` | `X-Pyrycode-Server: record.server`, `X-Pyrycode-Token: record.token`, `User-Agent: pyrycode-desktop/${clientVersion}`, `X-Pyrycode-Device-Name: deviceName` | **mirrors the live-validated mobile contract** (`OkHttpRelayTransport.kt`) field-for-field. The relay requires a non-empty `X-Pyrycode-Token` but **ignores its value under v2** — the Noise static-key handshake is the real gate. Do not deviate to a placeholder without a matching mobile/relay change (CLAUDE.md no-drift). |
| `connection.maxFrameBytes` | `MAX_FRAME_BYTES` (256 KiB) | tightens to the exact v2 cap (the supervisor's 1 MiB default already bounds; this is fidelity) |
| `session.staticPrivateKey` | `pair.privateKey` | raw 32B device static |
| `session.remoteStaticPublicKey` | `decodeServerKey(...)` | raw 32B |
| `session.prologue` | `new Uint8Array(0)` | zero-length matches the daemon |
| `session.hello` | `buildClientHello(...)` output | token + identity + optional pairing-scoped `last_event_id`; no `last_seen_ts` |
| `onEvent` | `onDriverEvent` | the single event-mapping choke point |

## The driver-event → DaemonEvent mapping (`onDriverEvent`)

### Inbound replay positions and resync

The generation-fenced `message` callback passes an envelope observer to
`parseInboundMessage`. It runs once after the plaintext-size and envelope guards,
before payload narrowing. Except for `resync`, a positive safe-integer `event_id`
advances the cursor only when greater than the held value. Missing, nonnumeric,
nonpositive, fractional and unsafe values leave it unchanged. Unknown frame types
and malformed payloads still advance a valid admitted position while retaining
their existing ignore/drop behavior. A rejected size or envelope guard cannot
record or reset anything; a superseded driver's events never reach the observer.

An admitted `resync` clears only this host's cursor regardless of payload shape,
ignoring its own `event_id`. The decoder returns `null`: no renderer event and no
automatic `request_history`. The next hello omits `last_event_id` until another
valid event establishes a new position, which may be lower than the old cursor.
Only the static `replay-cursor-reset` diagnostic with code `resync` is emitted;
no cursor, host id or payload enters it. An expired or unavailable tail therefore
leaves recovery to the existing history flow. Replayed events use the ordinary
live-event path; the daemon's watermark owns duplicate suppression.

The single choke point. Nothing else emits.

| `RelaySessionEvent` | Action |
|---|---|
| `handshake-complete{helloAck}` | `parseHelloAck` → authenticated `connected{ack}`, then drain held composer messages; a `parseHelloAck` throw → `failed('malformed-hello-ack')` (the caught `WireDecodeError` is dropped — its message could echo the ack bytes) |
| `message{plaintext}` | [`parseInboundMessage`](inbound-message-decode.md) → `messageReceived{message}` / `messagesReceived{messages}` / `runConfigReceived{sessionId,model,effort,yolo,used_tokens,window_tokens}` (#491/#500, superseding the `snapshotReceived{model,effort,yolo,used_tokens,window_tokens}` arm #180 originally emitted from the `case 'snapshot'` kind below, extended with the two usage ints by #191; that arm and its `case 'snapshot':` emit were removed outright by [#621](../codebase/621.md), and [#622](../codebase/622.md) removed the decode itself in turn — `inboundMessage.ts` no longer produces a `snapshot` kind at all, so a `screen_snapshot` frame now falls to `parseInboundMessage`'s tolerant `default` arm before this switch is ever reached) / `conversationsReceived{conversations}` (#139, no field dropped) / `turnState{state}` (#214, only `conversation_id` dropped) / `stallDetected{conversationId}` (#315, at ship time **nullary** — `StallPayload`'s only field, `conversation_id`, was dropped; [#732](../codebase/732.md) widened the arm to carry it onward by name, the id stopping at the renderer timeline bridge) / `apiRetry{active,current,total}` (#492, only `conversation_id` dropped — the not-onset-only, not-deduped peer of `stallDetected`; a fresh named-field literal copied by name, never a spread of the decoded payload) / `compacting{active}` (#495, only `conversation_id` dropped — `apiRetry`'s banner-only peer, carrying exactly one bool; same fresh-named-field-literal, never-a-spread discipline) / `toolUse{turnId,toolUseId,name,inputSummary}` (#217, only `conversation_id` dropped) / `modalShown{modalId,class,title,prompt,options,defaultOptionId}` / `modalDismissed{modalId,outcome,source}` (#201, at ship time **nothing dropped — a modal carried no `conversation_id`** on either frame; [#871](../codebase/871.md) widened `modalShown` to carry `conversationId` onward by name, decoded by [#870](../codebase/870.md) — outbound scoping only, `modalId` stays the sole answering correlation key; `modalDismissed` is unaffected) / `toolResult{turnId,toolUseId,isError,resultSummary}` (#229, only `conversation_id` dropped) / `conversationCreated{conversation}` (#241, verbatim passthrough — nothing dropped, like `conversations`) / `sessionTransition{newSessionId}` (#254, only `newSessionId` carried — `previous_session_id`/`reason`/`occurred_at`/`workspace_cwd` dropped here, the #180 content-drop model's second application) / `sessionSettingsUpdated{sessionId}` (#264, verbatim passthrough — nothing to drop, the reply has only the one field) / `backgroundTaskStarted{conversationId,taskId,toolCallId,description,taskType,truncatedFields}` (#564, **`conversation_id` KEPT as `conversationId`** — unlike every turn-stream arm above, this frame carries no `turn_id` and opens/closes no turn, so it follows the `queueState` #720 daemon-state rule; a fresh named-field literal copied by name, never a spread) / `backgroundTaskUpdated{conversationId,taskId,patch,status,summary,truncatedFields}` (#565, the subset twin of the arm above — four fields not six at ship time; [#1560](https://github.com/pyrycode/pyrycode-desktop/issues/1560) added `status`/`summary`, crossing verbatim, `''` included, so today it is six fields too — but a DIFFERENT six from the sibling's, `conversation_id` likewise KEPT, and performs **no join** against `backgroundTaskStarted`: ordering is claude's, not the daemon's, so an update for a never-opened task still emits; both new fields ship dormant, unread by any bridge until [#1561](https://github.com/pyrycode/pyrycode-desktop/issues/1561)/[#1246](https://github.com/pyrycode/pyrycode-desktop/issues/1246)) / `backgroundTaskRoster{conversationId,tasks,droppedTasks}` (#566, the **aggregate peer** of the two arms above — a snapshot, not a delta, whose empty `tasks` is the positive "nothing is alive" signal; `conversation_id` likewise KEPT, `tasks` passed through **by reference** from the already-narrowed row array, snake_case, the `queueState` nested-array precedent; no join, no dedup, no snapshot diff against a held previous roster) / `modelAnnounced{model,truncated}` (#587, **only `conversation_id` dropped** — an identity report, not a turn-stream item; fresh named-field literal copied by name, never a spread; deliberately stateless like `apiRetry`/`compacting`, so a verbatim repeat still emits); a throw (oversized/malformed/mistyped) → **drop** (no event, the caught `WireDecodeError` is dropped — its message could echo plaintext); an unmodeled envelope type (`null`) → **ignore**. The transport helper owns the wire boundary; this arm does only the IPC map. **Filled in [#68](../codebase/68.md)**, extended with the `snapshot` kind in [#180](../codebase/180.md), again with `used_tokens`/`window_tokens` in [#191](../codebase/191.md), again with the `conversations` kind in [#139](../codebase/139.md), again with the `turnState` kind in [#214](../codebase/214.md), again with the `stall` kind in [#315](../codebase/315.md) (not compile-forced — this inner switch has no `assertNever` default, so the round-trip test is the guard, not the compiler), again with the `api-retry` kind in [#492](../codebase/492.md) (same not-compile-forced posture), again with the `compacting` kind in [#495](../codebase/495.md) (same not-compile-forced posture), again with the `toolUse` kind in [#217](../codebase/217.md), again with the `modalShown`/`modalDismissed` kinds in [#201](../codebase/201.md), again with the `toolResult` kind in [#229](../codebase/229.md), again with the `conversation-created` kind in [#241](../codebase/241.md), again with the `session-transition` kind in [#254](../codebase/254.md), and again with the `session-settings-updated` kind in [#264](../codebase/264.md), and again with the `background-task-started` kind in [#564](../codebase/564.md) (same not-compile-forced posture), and again with the `background-task-updated` kind in [#565](../codebase/565.md) (same not-compile-forced posture), and again with the `background-task-roster` kind in [#566](../codebase/566.md) (same not-compile-forced posture), and again with the `model-announced` kind in [#587](../codebase/587.md) (same not-compile-forced posture) |
| `terminal{code, reason}` | if `stopped` → **suppress** (clean local teardown); else `failed('connection-closed', "…code ${code}")`. The supervisor `reason` string is **not** forwarded (conservative) |
| `error{reason}` | `failed(reason)` — the driver's reason is a static enum string, safe as the category `code` |
| `relay-link-up` ([#328](../codebase/328.md)) | `relayLinkChanged{status:'connected'}` — a fresh literal, distinct from the session `connecting`/`connected`/`failed` arms above |
| `relay-link-down{code}` ([#328](../codebase/328.md)) | classify `code === RELAY_NO_DAEMON_CLOSE_CODE (4404)` → `relayLinkChanged{status:'daemon-absent'}`; else → `relayLinkChanged{status:'offline'}`. **This is the untrusted→trusted classification boundary** — the raw relay-controlled close code is dropped here; only the category crosses IPC |

## `failed`, not `disconnected`

The store's `disconnected` means "we deliberately stopped." Every other non-`connected` outcome here is a failure-to-establish or an authoritative drop the user should see, so it maps to `failed{error: {code, message, retryable: false}}` — a static category `code` plus a fixed generic `message`. Clean `stop()` emits no connection-status event, but marks held messages `not-sent` before releasing them. Richer failed-vs-disconnected + per-drop status choreography is deferred to [#34](https://github.com/pyrycode/pyrycode-desktop/issues/34)/[#35](https://github.com/pyrycode/pyrycode-desktop/issues/35). Category codes: `not-paired`, `connect-failed` (the bootstrap catch-all), `malformed-hello-ack`, `connection-closed`, plus the driver's own error-reason enums verbatim.

## Composition-root wiring (`src/main/index.ts`)

The synchronous `app.whenReady().then(...)` callback constructs one
[connection registry](daemon-connection-registry.md) over the shared paired-server store. Its
factory gives each `createDaemonConnection` its own `serverId` and record view, the shared device
keypair and logger, and `correlations.observe(router.observe(live.sink))` for event delivery.
Pairing and unpairing invoke `registry.reconcile()` to make the held set follow the stored records.

Each window's `did-finish-load` calls `live.replayStatus()` then `registry.start()`. The registry's
idempotent start waits for its initial store read; reopening or reloading a window replays status
without replacing live connections. Quit calls `registry.stop()` before draining history, and
again idempotently on `will-quit`. See [live window](live-window.md) for the window holder.

For explicit recovery of one host, `registerReconnectServerHandler(ipcMain, { registry,
diagnosticLog })` is registered once after the registry, beside the unpair handler. Its cleanup
removes `pyry:reconnect-server` on `will-quit`; registration is process-wide, outside `openWindow`.
`window.pyry.reconnectServer(serverId)` sends the fixed-channel request and the handler validates
it before calling `registry.reconnect(serverId)`. See the
[registry's IPC contract](daemon-connection-registry.md#named-host-reconnect-ipc) for exact matching,
no-op cases, the closed request shape and constant diagnostics.

A matched request calls the held `DaemonConnection.reconnect()`: each call starts a fresh dial,
even when the pairing record is unchanged. This can restart dialing after a terminal failure ended
[relay supervision](relay-supervisor.md). Repeated requests are not idempotent or coalesced;
the existing [generation fence](#the-generation-fence) supersedes earlier work, and `stop()` keeps
a permanently stopped connection inert. Automatic retry policy is unchanged.

The invoke acknowledgement contains no result data and does not wait for a handshake. A fresh
dial emits `connecting` synchronously, then reports progress and outcome through existing
`DAEMON_EVENT_CHANNEL` events stamped with the connection's server id. Callers must observe those
events to learn whether reconnect succeeded. The named entry point ends at preload; the composer
control and its integrated proof belong to
[#1510](https://github.com/pyrycode/pyrycode-desktop/issues/1510).

# State + concurrency model

- **Main-process state.** Driver/lifecycle handles, generation, the pairing-scoped replay cursor and composer payload FIFO stay here. Renderer session state lives in the [session store](session-store.md); replay position is never an IPC field.
- **The `start()`/`stop()` race** is closed by checking `stopped` after asynchronous dial loads, before null classification and immediately before synchronous driver construction. JS yields only at `await`: a stop during load/key ensure cancels output; a stop after construction tears down the held driver.
- **`stopped` does double duty** — it is both the start/stop race guard *and* the "suppress the clean-stop terminal" flag, so no separate `stopping` boolean is needed.
- **`generation` is a second, orthogonal fence for `reconnect()`** ([#82](../codebase/82.md)) — it supersedes an in-flight dial when a fresh one begins, dropping the old driver's stop-terminal and aborting a stale `bootstrap`. `stop()` deliberately does not bump it (permanent teardown stays `stopped`'s job), so the pre-`createDriver` guard checks both. Full model in § Connect-on-pair.
- **Transient reconnects are invisible here.** The supervisor absorbs transient drops and re-dials the *same* driver without surfacing `terminal`; on reconnect the driver **re-sources the record via `loadDialConfig`** ([#83](../codebase/83.md)) then runs a fresh handshake and fires another `handshake-complete` → this re-emits `connected`. During the gap the UI stays on its last status. (This is distinct from `reconnect()`, which **replaces** the driver entirely — see § Connect-on-pair.)

# Per-server routing

Until #1117 the composition root held exactly **one** `DaemonConnection`. Since #1117 the set of live
connections follows the set of paired records, and #1118/#1119 route existing commands to the specific
connection each belongs to rather than to whichever server was paired most recently. That history — the
connection registry, conversation-id routing, and correlation-id routing — now lives in its own document,
split out 2026-09-05 to keep this one under the size cap:

- [Daemon connection — per-server routing](daemon-connection-routing.md)

# Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS**.

- **No secret ever crosses to the renderer.** Connection status uses `connecting` (empty), `connected{ack}` (public handshake fields) and `failed{error}` (static category codes); local `messageDelivery` exposes only correlation IDs and a closed status, with the host stamp. The token, the private key, the decoded server pubkey, the `hello` bytes, and raw frames stay in the main process.
- **Content-free-log by construction; classify-don't-forward.** No `console.*` (a stray log could echo the token, keys, or handshake bytes). Every caught error object is **dropped** — only a static category `code` is surfaced — because a codec/keychain error message can echo the token or transcript bytes. Pinned by a six-method `console`-spy across the happy path and every reject branch (inherited [#5](wire-codec.md)/[#7](noise-session.md)/[#22](relay-supervisor.md)/[#50](noise-relay-driver.md)). Since [#128](../codebase/128.md) the module also *shadows* its lifecycle onto the injected [#126 diagnostic log](diagnostic-log.md) — but still content-free: only the static classification `code` and the event name reach the sink, never the caught object, the banner text, the ack bytes, or the numeric close code. See § Diagnostic logging.
- **Fail-closed inputs.** A wrong-length/bad-base64 server key, a missing record (`load()` → `null`), or a malformed one (`MalformedPairedServerRecordError`) each surfaces as a non-connected event, never a crash.
- **The token-in-header exposure is the bounded, documented caveat.** The real device token rides in the relay-readable `X-Pyrycode-Token` upgrade header — mirroring the mobile contract (deviating would drift from mobile). It is **not** a standalone impersonation credential: the daemon authenticates the device via the Noise_IK static-key handshake (the device static private key never leaves the machine), so a relay that harvests the header token cannot impersonate the device. The standing mitigation is log-freedom.
- **A narrow reconnect capability.** The fixed `pyry:reconnect-server` invoke can reach only a held
  host through the registry; it cannot supply an endpoint, read pairing secrets or expose a
  connection object. Lifecycle outcomes still use `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent`.
  Window `webPreferences` (`sandbox`, `contextIsolation`) are unchanged.
