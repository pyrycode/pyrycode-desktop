# Fake daemon (in-process Noise_IK responder)

`src/main/transport/fakeDaemon.ts` is a reusable, **test-only**, in-process Noise_IK **responder** — a "fake daemon" that speaks the responder side of the wire protocol so automated tests can drive the **real client initiator** through a genuine `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake and one sealed transport round-trip in CI, with **no Go toolchain and no network**.

It is the **content-aware peer** the content-blind [fake relay forwarder](fake-relay-forwarder.md) (#90) splices frames to: the daemon dials the forwarder's `…/v1/server` leg, the real client under test dials `…/v1/client`. Together they are the transport-level round-trip harness. The daemon is the **responder half** of that harness; the consuming round-trip test that drives both — [#89](../codebase/89.md) — has **landed**. Introduced in [#91](../codebase/91.md). Since [#112](../codebase/112.md) it also gains a **rekey-INITIATOR capability** — it can seal a `rekey_request`, answer the client's fresh `noise_init` as a fresh responder handshake, and atomically swap its own ciphers — so an assembled real client session can be driven through a daemon-initiated rekey end-to-end (see § Rekey-initiator capability).

Where `noiseSession.ts` is **initiator-only**, this is its responder mirror. The one prior responder is the Go `flynn/noise` peer behind `noiseSession.interop.test.ts` — it needs the Go toolchain, is driven over stdio, and `describe.skipIf(!goAvailable)` skips whenever `go` is absent, so it cannot back an **unconditional** `npm test` round-trip. The fake daemon fills exactly that gap, in-process.

## Why a "faithful" fake

A lax fake gives false confidence. Mobile's connection-layer bugs surfaced **only** under a real round-trip; the whole point of this ticket is to make such a round-trip reproducible in CI. So the fake is held to fidelity:

- It uses the **exact `NOISE_PROTOCOL` constant** (`Noise_IK_25519_ChaChaPoly_BLAKE2s`, reused verbatim from `src/shared/wire/types`) — no divergent hash suite that could let a handshake pass while diverging from the daemon.
- It uses the **production `codec`** for all framing — `encodeEnvelope`/`decodeEnvelope` (the Noise-plaintext layer), `encodeInnerFrame`/`decodeInnerFrame` (the relay-frame layer), `base64Std*` — never a hand-rolled shortcut. Building `hello_ack` is the exact inverse of the client's `parseHelloAck`; recovering the client `hello` runs it through `decodeEnvelope` exactly as the real daemon parses it.
- Its handshake, key schedule, and ChaChaPoly AEAD all come from the vetted `noise-c.wasm` via the one shared `loadNoiseLib` — **no hand-rolled crypto**.

This is the deliberate opposite of the forwarder's discipline. The forwarder is **content-blind** — its import list forbids `codec`/Noise. The fake daemon **is** the content-aware peer, so those imports are correct and **required by the fidelity ACs**.

## Public surface

```ts
export function startFakeDaemon(options: FakeDaemonOptions): Promise<FakeDaemon>

export interface FakeDaemonOptions {
  url: string                                             // forwarder base URL; the daemon dials `${url}/v1/server`
  buildReply?: (inboundPlaintext: Uint8Array) => Uint8Array  // default: echo the inbound plaintext verbatim; ignored when buildReplyFrames is set
  buildReplyFrames?: (inboundPlaintext: Uint8Array) => Uint8Array[]  // streams an ordered list of plaintexts, each
                                                          //   sealed as its own noise_msg (#116); takes precedence over buildReply
  helloAck?: Partial<HelloAckPayload>                     // defaults: v2 / 'fake-daemon' / 'conn-1' / []
  loadTimeoutMs?: number                                  // forwarded to loadNoiseLib as its load deadline
  rekeyResumeMessage?: Uint8Array                         // plaintext sealed under the NEW keys after a rekey swap (#112);
                                                          //   default: DEFAULT_REKEY_RESUME_MESSAGE (a canned `message` envelope)
  reconnectResendFrames?: Uint8Array[]                    // ordered plaintexts re-sealed under the NEW send cipher right
                                                          //   after a RECONNECT handshake's hello_ack (#416); default []
}

export interface FakeDaemon {
  staticPublicKey: Uint8Array          // responder static X25519 pubkey (32B) — the client pins it as remoteStaticPublicKey
  whenSettled(): Promise<FakeDaemonOutcome>   // resolves once (cached); never rejects
  initiateRekey(): void                // as the daemon: seal a rekey_request + answer the client's fresh noise_init (#112); no-op unless in `transport`
  pushFrame(plaintext: Uint8Array): void  // server-initiated push (#416): seal under the CURRENT send cipher + stream; no-op unless in `transport`
  close(): Promise<void>               // tear down leg + free wasm state; idempotent
}

// A fixed `message` envelope the daemon seals under the NEW send cipher right after a rekey swap —
// the client's deterministic swap signal (there is no rekey_ack). Pure module-load constant (#112).
export const DEFAULT_REKEY_RESUME_MESSAGE: Uint8Array

export type FakeDaemonOutcome = { ok: true } | { ok: false; reason: FakeDaemonErrorReason }

export type FakeDaemonErrorReason =
  | 'frame-decode-failed'       // decodeInnerFrame/base64StdDecode threw at the leg boundary
  | 'handshake-read-failed'     // msg1 ReadMessage MAC-failed / malformed / wrong-suite peer
  | 'transport-decrypt-failed'  // an inbound transport frame failed to open
  | 'closed'                    // close() ran before the round-trip completed
```

`startFakeDaemon` resolves once the wasm is loaded, the keypair generated, `hs` initialised, and the `/v1/server` leg has fired `open` with its `message` handler armed — so the client's msg1 (which the test only sends after `forwarder.whenReady()`) is never dropped. It **rejects** only with `NoiseLoadError`, and only when the shared wasm load fails/times out (the one surface where no handle exists yet, so a rejection is the correct async shape — mirrors `createNoiseSession`).

`staticPublicKey` is the responder static the client pins as its `remoteStaticPublicKey` — the in-process stand-in for the "QR-known server static" the real client pins. A fresh keypair is generated per `startFakeDaemon`, so no key/nonce reuse across runs.

## How it works — the responder state machine

Four states, driven entirely by the leg's `message` events: `awaiting-msg1` → `transport` → `closed` (terminal), plus `awaiting-rekey-init` (a rekey may loop `transport → awaiting-rekey-init → transport`, entered only via `initiateRekey`, see § Rekey-initiator capability). `DaemonState` gained no fifth member for reconnect ([#416](../codebase/416.md)) — a reconnect is entered and exited by an inner-frame-type peek within `transport`, not a state transition (see § Reconnect capability). Keys and wasm never leave the module (main-process only; there is no renderer on this side).

**On every inbound leg `message`** (relay frames arrive as WS **text** frames — the client sends `encodeInnerFrame(...)`, a JSON string):

0. **Inert after close.** If `state === 'closed'`, return immediately — never touch a freed wasm object (mirrors `noiseSession.ts`). A garbage frame arriving after `close()` ran `freeAll()` is the use-after-free this guard defends against.
1. **Leg boundary (the one untrusted→trusted seam).** Normalise `RawData → Uint8Array`, then decode the whole `InnerFrameV2` (capturing its `.type`, not just `.data`) via `decodeInnerFrame`, then `raw = base64StdDecode(inner.data)`. On any throw → settle `{ ok:false, reason:'frame-decode-failed' }`, close. Fail-closed, category-only, the caught object dropped (a library error string can echo transcript bytes). The inner `type` field is now consulted, but **for routing only** ([#416](../codebase/416.md)): in `transport` state, a `noise_init` routes to `handleReconnect` (§ below) instead of `handleTransport` — exactly the signal the real driver documents (`noiseRelayDriver.ts` tags a reconnect's first outbound frame `noise_init` "so the daemon routes them to a handshake path, not transport-decrypt"). Transport-frame **interpretation** still relies solely on the Noise state machine + AEAD (mirrors `noiseRelayDriver.onMessage`): a hostile `type` cannot misroute an actual transport frame, and a hostile `noise_init` only triggers a fresh-handshake attempt that fails closed, never a downgrade or a transport bypass.
2. **`awaiting-msg1`.** `hs.ReadMessage(raw, true)` recovers the client `hello` early-data (and the client static, per IK). `decodeEnvelope(hello)` confirms a well-formed `hello` envelope (faithfulness — the real daemon parses it too). Build the ack via `encodeEnvelope({ id, type:'hello_ack', ts, payload: helloAck })`; `msg2 = hs.WriteMessage(helloAckBytes)`; `const [send, recv] = hs.Split()` → `sendCipher = send`, `recvCipher = recv` (see the Split note); frame + send `msg2`. → `transport`. On any throw (wrong hash suite, wrong responder static → the encrypted static/payload MAC-fails here): the library auto-freed `hs`; null it, settle `{ ok:false, reason:'handshake-read-failed' }`, close.
3. **`transport`.** `plaintext = recvCipher.DecryptWithAd(EMPTY_AD, raw)`. On throw → settle `{ ok:false, reason:'transport-decrypt-failed' }` (the cipher survives; non-terminal — the session stays open). Else `reply = buildReply(plaintext)` (default echo); `ct = sendCipher.EncryptWithAd(EMPTY_AD, reply)`; frame + send. On the **first** reply, settle `{ ok:true }`. **The session stays open** — subsequent transport frames continue to decrypt + reply; `whenSettled` stays resolved at its first value.

`whenSettled()` is a **diagnostic aid**, not the primary oracle: it turns a daemon-side failure into a crisp `{ ok:false, reason }` instead of a mysterious client-side timeout. The primary oracle is the round-trip assertion in the consuming test (the sealed reply decrypting to the expected payload). It mirrors the Go interop responder's `ERR <reason>` line and the codebase's sealed-union discipline.

## The `Split()` send/recv mapping — the load-bearing detail (AC4)

**The responder uses the SAME mapping as the initiator:** `const [send, recv] = hs.Split(); sendCipher = send; recvCipher = recv` — **no swap.**

`noise-c.wasm` returns the two transport ciphers **already role-adjusted as `[send, recv]` for BOTH roles** (`noise-c.wasm.d.ts:47-51`; the underlying `noise_handshakestate_split(state, **send, **recv)` fills send/recv per the role the `HandshakeState` was built with — here `NOISE_ROLE_RESPONDER`). So the responder's `Split()[0]` is already its **send** cipher (responder→initiator, c2) and `[1]` its **recv** (initiator→responder, c1).

**Why the ticket's "responder maps the opposite way" note does not apply here.** That note (and `noiseSpikeResponder/main.go`'s `recv, send := cs1, cs2` swap) describes the **flynn/noise Go** responder, which returns the **raw** `(c1, c2)` pair and forces the caller to swap by hand. The interop test paired a noise-c **initiator** (no swap) with a flynn **responder** (manual swap) — each side swaps at most once. This harness pairs a noise-c initiator with a **noise-c** responder; both role-adjust internally, so **neither** swaps. Copying the flynn swap would double-adjust and invert the responder's ciphers.

**Why this is security-load-bearing, not just a functional bug:** a crossed mapping would encrypt the responder's outbound under the **same key + nonce-0** the initiator uses for *its* outbound — a catastrophic `(key, nonce)`-reuse class error. So it is pinned with a **deterministic** test, not stochastic reasoning: a crossed mapping **completes the handshake** (msg2 reads fine — the handshake hash matches) but **MAC-fails the first transport frame** (the client emits `transport-decrypt-failed` and never a `message`, so the round-trip assertion fails hard). **This round-trip decrypting-not-MAC-failing IS AC4's coverage.**

## Framing fidelity (AC3)

- **Inbound:** the client writes `InnerFrameV2` as WS **text** frames (`encodeInnerFrame` → string → `ws.send(string)`). The forwarder preserves the opcode. The daemon receives text, normalises to bytes, `decodeInnerFrame`.
- **Outbound:** the daemon sends `leg.send(encodeInnerFrame({ v:2, type:'noise_msg', data: base64StdEncode(raw) }))` — a string → text opcode, mirroring the client. `noise_msg` for **both** msg2 and transport replies is faithful and safe: the client does **not** branch on the inbound `type` (`noiseRelayDriver.onMessage`), so the reply `type` tag is not load-bearing.

## Rekey-initiator capability ([#112](../codebase/112.md))

Beyond the single-round-trip responder, the daemon can **initiate** an in-session rekey — the responder-side twin of the mechanism [#111](noise-session.md#rekey-re-handshake--atomic-cipher-swap-111) built in the real client session, framed through the codec over the WS leg. The crypto is **faithful** (a lax fake can pass while diverging from the real daemon); the outbound `type` tag stays uniform `noise_msg` for every rekey frame too (the client reads by session state, never the inbound tag — § Framing fidelity).

- **`initiateRekey()`** (no-op unless `state === 'transport'` with a live send cipher): build a `rekey_request` control envelope via `encodeEnvelope` (fixed `REKEY_REQUEST_ID`/`REKEY_REQUEST_TS` — the client's #108 recognizer peeks only `.type`, so fixed values keep the fake wall-clock-free), AEAD-seal it under the **current** send cipher, set `state = 'awaiting-rekey-init'` **before** `sendNoise` (re-entrancy discipline mirroring the session), then send.
- **`handleRekeyInit(raw)`** (the `awaiting-rekey-init` branch) answers the client's fresh `noise_init` (`msg1`) as a fresh handshake **as RESPONDER**, mirroring `handleMsg1` but with **empty early-data both ways** (no `hello` recovered, no `hello_ack` sent — the token is not re-transmitted on a rekey): a fresh `HandshakeState(RESPONDER)` reusing the **SAME** static via a byte-identical `Initialize(null, staticPriv, null, null)`; `ReadMessage(raw, true)` (discard the empty early-data); `WriteMessage(EMPTY_AD)` → `msg2`; `Split()` → `[send, recv]` **no swap** (the same load-bearing mapping as the initial handshake — § The `Split()` send/recv mapping); the **atomic swap** installs both new ciphers before freeing either old one, nothing fallible between the two assignments (identical discipline to `handleMsg1` / `noiseSession.ts`). Then it streams `msg2` and — under the **new** send cipher — a **resume frame** (§ below). On any throw: classify `handshake-read-failed`, drop the caught object, tear down (mirrors `handleMsg1`; no new `FakeDaemonErrorReason` member).

**The post-swap resume frame is the client's deterministic swap signal.** There is **no `rekey_ack`**, and #111's client emits no event on a successful swap (implicit ack), so a test driving the real client has **no client-side signal** that the swap to the new keys finished. The daemon sealing one frame under the new keys immediately after its swap — `rekeyResumeMessage`, default `DEFAULT_REKEY_RESUME_MESSAGE` — gives an ordered, deterministic receipt: the forwarder splices in order, so it arrives **after** the `msg2` the client swapped on, decrypts under the client's fresh recv cipher, and surfaces as a client `message`. That receipt proves the client's recv cipher rotated. It is crypto-faithful (any daemon→client frame under the new keys is identical crypto to the daemon streaming the next turn); *who* sends the first post-rekey frame is a harness choreography detail, not a protocol divergence. `handleTransport` is unchanged — a subsequent client send after the swap already decrypts under the new (rotated) ciphers, so the K1 round-trip goes through `buildReply` as usual.

## Reconnect capability ([#416](../codebase/416.md))

Beyond the rekey path, the daemon survives a client drop and answers the client's **reconnect**, a
different shape from the in-session rekey: on a relay drop, `noiseRelayDriver.onConnected` builds a
**fresh** `createNoiseSession` carrying `material.hello` — a full IK handshake tagged `noise_init` on the
wire, not empty-early-data. `handleReconnect(raw)` — entered from `onMessage` when a `transport`-state
frame's inner `type` is `noise_init` (§ leg boundary above) — is therefore composed from **both**
existing precedents rather than being a third, novel handshake:

- `handleMsg1`'s hello-recovery + validation: a fresh `HandshakeState(RESPONDER)` reusing the **same**
  responder static, `ReadMessage(raw, true)` recovers the client's `hello` early-data, `decodeEnvelope`
  validates it exactly as the real daemon would (a malformed hello fails closed — faithfulness), then
  `WriteMessage` builds the **same** `hello_ack` payload the daemon was constructed with (so a test can
  assert ack equality across the initial and the reconnect handshake).
- `handleRekeyInit`'s atomic cipher swap: `Split()` a fresh pair, capture both previous ciphers, install
  both new before freeing either old, nothing fallible between the install and the free.

Then, **under the new send cipher**, it streams `reconnectResendFrames` in order (default `[]`) —
generalizing `rekeyResumeMessage`'s single canned frame to an arbitrary, test-supplied list. Streaming
strictly after `hello_ack` is what guarantees a client processes the reconnect's `connected` event (and
whatever reset it triggers downstream) before any re-sent frame's repopulation arrives — the load-bearing
ordering the [#416 e2e](../codebase/416.md) pins.

**`pushFrame(plaintext: Uint8Array): void`** is the complementary server-initiated push: seal `plaintext`
under the **current** send cipher and stream it — `initiateRekey`'s seal-and-stream pattern minus the
state transition. No-op unless a completed session is in `transport`. This is how a test raises an
out-of-band event (e.g. a modal) mid-session, independent of any reconnect.

Both `handleReconnect` and `reconnectResendFrames`/`pushFrame` are **modal-agnostic** — they move opaque
`Uint8Array` envelopes only. The modal specifics (a crafted `modal_shown` frame) live entirely in the
consuming [#416](../codebase/416.md) e2e, so a future reconnect e2e for another slice (e.g. the queue
store, [#197](../codebase/197.md)) can reuse this capability unchanged.

## Error handling

| Failure mode | Behaviour |
|---|---|
| Malformed `InnerFrameV2` / bad base64 at the leg boundary | Fail-closed: settle `{ ok:false, 'frame-decode-failed' }`, drop the caught object (no bytes), close. |
| msg1 MAC-fails (wrong hash suite, wrong responder static) | `hs` auto-freed by the library; null it, settle `{ ok:false, 'handshake-read-failed' }`, close. |
| Rekey `msg1` (fresh `noise_init`) fails to read | Library auto-freed the fresh handshake, no cipher was reassigned (old keys intact); settle `{ ok:false, 'handshake-read-failed' }`, close — mirrors msg1 (#112). |
| Reconnect `msg1` (`transport`-state `noise_init`) fails to read | Same shape as the rekey case: fresh handshake auto-freed, both ciphers still hold the OLD keys (no torn state); settle `{ ok:false, 'handshake-read-failed' }`, close — no new `FakeDaemonErrorReason` (#416). |
| Inbound transport frame fails to open | settle `{ ok:false, 'transport-decrypt-failed' }`; cipher survives (non-terminal, session stays open). |
| wasm load fails / times out | `startFakeDaemon` **rejects** with `NoiseLoadError` (no handle exists yet). |
| Leg drops mid-handshake / `close()` before completion | Pending `whenSettled` resolves `{ ok:false, 'closed' }`; teardown proceeds; idempotent. |

**Log-free by construction** (mirrors `noiseSession.ts` / `codec.ts`): no `console.*`; no key/token/frame/plaintext bytes in any diagnostic. Every caught wasm/codec object is classified to one static `FakeDaemonErrorReason` and **dropped**. All observable behaviour is via the handle and the spliced frames.

## Edge cases and limitations

- **Single round-trip fake, not a full daemon.** It completes the handshake, HELLO exchange, then decrypts + replies to transport frames while keeping the session open. It does **no** conversation logic, streaming semantics, or multi-message orchestration beyond echo/`buildReply`.
- **Reply shape defaults to echo.** The default `buildReply` echoes the decrypted inbound plaintext — the simplest deterministic contract for the crypto round-trip proof, matching the Go interop responder. A caller (e.g. #89) can pass a `buildReply` returning a canned `message` envelope for a more daemon-faithful reply; a real daemon would answer a `send_message` with a `message`/`ack` envelope, not a byte-echo.
- **Fixed empty prologue.** The client's default handshake prologue is empty (`Initialize(null, staticPriv, null, null)`; noise-c treats zero-length prologue as "unset"), so the prologue is not exposed as an option.
- **Bounded inbound frames.** The leg dials with `maxPayload: MAX_FRAME_BYTES`, the same cap the production `relayConnection` uses — defensive hygiene so an oversized frame can't grow memory.
- **`ws://` loopback is justified.** This is in-process loopback (`ws://127.0.0.1:<ephemeral>`) test infra dialing a URL the harness itself minted; the production `wss://`-only rule targets remote relays and does not apply.
- **TEST-ONLY — must never enter the production graph.** It holds a Noise static key and a permissive `ws://` dialer. Its only importers are `*.test.ts` and (later) the #89 consumer — never `src/main/index.ts`, `src/preload`, or `src/renderer`. Importing it into production would ship a second Noise static-key holder and a permissive dialer. Enforced by the module's test-only header comment + code-review of its import sites (mirrors how `fakeRelayForwarder.ts` stays test-only; the PR verified it is absent from the `out/main/index.js` bundle).

## Related

- [Fake relay forwarder](fake-relay-forwarder.md) / [#90](../codebase/90.md) — the content-blind plumbing half this daemon dials (`/v1/server`); the deliberate inverse discipline (blind vs. content-aware).
- [Noise session](noise-session.md) / [#7](../codebase/7.md) — the initiator this daemon mirrors as a responder; the structural template (`HandshakeState`/`Initialize`/`WriteMessage`/`ReadMessage`/`Split`, `freeAll` teardown, the log-free error discipline).
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `buildClientHello`/`parseHelloAck`; the daemon builds `hello_ack` as the inverse of `parseHelloAck` and the consuming test builds the client `hello` via `buildClientHello`.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `encode/decodeEnvelope`, `encode/decodeInnerFrame`, `base64Std*`; the production framing the daemon uses instead of a hand-rolled shortcut (AC3).
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — confirms the client's outbound `noise_init`→`noise_msg` tag sequence and that the client does **not** branch on the inbound `type` (so the reply tag is not load-bearing); its [#112](../codebase/112.md) `rekeyInitPending` latch re-arms `noise_init` for the fresh rekey `msg1` this daemon reads in `awaiting-rekey-init`.
- [Noise session](noise-session.md) / [#111](../codebase/111.md) — the real client session's rekey re-handshake + atomic swap this daemon's rekey-initiator capability ([#112](../codebase/112.md)) is the responder-side twin of; the assembled-stack e2e ([`daemonConnection.roundtrip.test.ts`](daemon-connection.md), #89) drives them together through a daemon-initiated rekey.
- [#91 codebase notes](../codebase/91.md) · Spec: `docs/specs/architecture/91-fake-daemon-noise-responder-roundtrip.md` · PR [#95](https://github.com/pyrycode/pyrycode-desktop/pull/95). Split from [#88](https://github.com/pyrycode/pyrycode-desktop/issues/88); blocked-by #90.
- Consumer: [#89](../codebase/89.md) — the round-trip test that drives this daemon, overriding `buildReply` to return `message`/`message_chunk` envelopes (the richer reply this doc forecast). **Landed.**
- Consumer: [#435](../codebase/435.md) — the milestone UI e2e specs (#93/#94) use a per-run `buildReply`/`buildReplyFrames` to seed a one-row `conversations` reply, giving ChannelList a clickable row so the drive can reach the conversation thread through real product UI; #94 additionally dispatches `buildReplyFrames` on the decoded inbound type (`send_message` → `[assistant_delta, turn_end]`, everything else → the row seed).
- [#416 codebase notes](../codebase/416.md) — adds the reconnect capability (`handleReconnect`, `pushFrame`, `reconnectResendFrames`, § above), narrows the leg-boundary module-header claim to "routing only," and the genuine-reconnect e2e that proves [#415](../codebase/415.md)'s renderer reconcile against a real supervisor re-dial through this daemon + the [fake relay forwarder](fake-relay-forwarder.md)'s matching `dropClientLeg` capability.
- Cross-project prior art: pyrycode `fakerelay-harness.md` + the fake-phone peer (`internal/e2e`, #295 tree) — the same forwarder → fake-peer → consuming-test phasing; the desktop daemon deliberately drops the Go surface and ports only the structuring rationale.
