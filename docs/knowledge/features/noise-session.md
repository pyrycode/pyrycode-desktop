# Noise session

The **production Noise session**: a pure main-process crypto unit that performs the `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake with the daemon and then encrypts/decrypts transport frames, so the relay socket can carry a **confidential, authenticated** channel. It is the desktop equivalent of the mobile client's Noise session and the JS peer of the daemon's Go `flynn/noise` stack (pyrycode `internal/noise`, #433) — reuse is the **wire format**, not code.

Introduced in [#7](../codebase/7.md), which **promotes** the throwaway `createNoiseInitiator` harness proven by the two Noise spikes ([#29](../codebase/29.md) library selection, [#30](../codebase/30.md) Go↔JS interop, verdict **RECOMMEND**) into a production module — `git mv` + rename carries the proven state machine verbatim; the one genuinely new surface is a shared hardened wasm loader. It lives **entirely** in `src/main/transport/` alongside the [relay connection](relay-connection.md) whose `send`-out / `onEvent`-in shape it mirrors ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). Keys, wasm, cipher state, and plaintext never reach the renderer, preload, or IPC.

## What it does

Gives the background process **one factory** — `createNoiseSession(config): Promise<NoiseSession>` — that builds an IK **initiator** from injected keys and returns an idle handle:

- **`start()`** writes IK message 1 (carrying the injected `hello` as early-data) to `sendFrame`, exactly once.
- **`onFrame(frame, innerType?)`** feeds one inbound frame: first it reads message 2 (recovering `hello_ack` and splitting into transport ciphers), then every later frame is AEAD-decrypted. Since [#532](../codebase/532.md), the optional `innerType` — the frame's `InnerFrameV2.type` label, forwarded by the driver — is consulted in exactly one state, `awaiting-rekey-reply` (see [Rekey-window routing by inner frame type](#rekey-window-routing-by-inner-frame-type-532) below); every other state ignores it.
- **`sendMessage(plaintext)`** AEAD-seals one post-handshake plaintext to `sendFrame` in `transport` state. Since [#533](../codebase/533.md), a send issued while parked in `awaiting-rekey-reply` is held (a copy) rather than dropped, and flushed sealed under the new cipher once the rekey's atomic swap lands (see [Outbound send buffering across the rekey window](#outbound-send-buffering-across-the-rekey-window-533) below); every other non-`transport` state stays inert.
- **`close()`** frees the wasm handshake + cipher state and leaves every entry point inert.

It is a **pure crypto unit**: keys are **injected** (raw 32-byte X25519 static private + remote static public), it sources nothing from storage and constructs no envelope. Since [#108](../codebase/108.md) it does one narrow **type-peek** in `transport` state — it decodes the already-decrypted plaintext just far enough to read the envelope `type` and recognize the daemon's `rekey_request` control frame (see [Rekey-request recognition](#rekey-request-recognition-108)) — but it still **constructs** no envelope and **interprets** no payload; app-message decoding stays downstream in [`parseInboundMessage`](inbound-message-decode.md). On that recognized trigger it now also runs a **fresh in-session IK re-handshake** and atomically swaps its cipher states ([#111](../codebase/111.md), see [Rekey re-handshake + atomic cipher swap](#rekey-re-handshake--atomic-cipher-swap-111)) — the one place the session performs more than a single handshake, so a long-lived session outlives the daemon's rekey interval. The `hello`/`helloAck` are **opaque bytes** — building them (device-token envelope) is the [hello exchange](hello-exchange.md) layer's job ([#10](../codebase/10.md)); sourcing the keypair is [#43](../codebase/43.md)'s. The suite `NOISE_PROTOCOL` is reused **verbatim** from `src/shared/wire/types.ts` — a mismatch fails the handshake **silently** ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md)), so it is never retyped.

## How it works

Two production files in `src/main/transport/`:

| File | Role |
|---|---|
| `noiseSession.ts` | The production session: the config/event/handle contract, the `idle → awaiting-handshake-reply → transport ⇄ awaiting-rekey-reply → closed` state machine, `freeAll()`, empty-AD encrypt/decrypt, the `Split()` no-swap, fail-closed decrypt, no-use-after-close guards, and — since [#108](../codebase/108.md)/[#111](../codebase/111.md) — the in-session `rekey_request` recognition + re-handshake + atomic cipher swap. Core carried verbatim from the #29/#30 harness (renamed). |
| `noiseLib.ts` | The **single hardened wasm loader** + `NoiseLoadError`. Loads `noise-c.wasm` **once per process** and memoizes the successful `NoiseLib`; both the session and the [device keypair generator](device-keypair.md) share this one instance. The genuinely new code — closes the async-load hang gap ([#29](../codebase/29.md) NIT). |

`noise-c.wasm@0.4.0` is a vetted Emscripten build of `rweather/noise-c` (the reference C implementation) — **no hand-rolled crypto**. The nonces are per-direction 64-bit counters **owned by the library**; the module never constructs, resets, or reuses a `(key, nonce)` pair, and associated data is **empty** on every op.

### Public surface — `noiseSession.ts`

```ts
export interface NoiseSessionConfig {
  staticPrivateKey: Uint8Array        // raw 32-byte X25519, injected (never from storage)
  remoteStaticPublicKey: Uint8Array   // raw 32-byte X25519, injected (known up front, from the QR)
  prologue: Uint8Array                // zero-length matches the daemon (passed as null internally)
  hello: Uint8Array                   // early-data for IK msg 1 — opaque here (the sibling builds it)
  sendFrame: (frame: Uint8Array) => void  // outbound raw-frame sink (e.g. relay.send); must not throw
  onEvent: (event: NoiseSessionEvent) => void  // typed sink; must not throw
  loadTimeoutMs?: number              // forwarded to loadNoiseLib; omit for the loader default
  diagnosticLog?: DiagnosticLog       // #133 — optional; logs the capped raw frame at the three inbound-read catches
}

export type NoiseSessionErrorReason =
  | 'handshake-read-failed'      // msg 2 failed MAC / malformed / wrong-suite / wrong-key peer
  | 'transport-decrypt-failed'   // a post-handshake frame failed to open (tamper / wrong key)
  | 'unexpected-frame'           // a frame arrived in the wrong state
  | 'rekey-send-buffer-full'     // #533 — a windowed send arrived at MAX_BUFFERED_SENDS; that one send was dropped
  | 'rekey-send-abandoned'       // #533 — the rekey failed; every buffered plaintext was discarded unsent

export type NoiseSessionEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array }  // peer early-data recovered from msg 2
  | { type: 'message'; plaintext: Uint8Array }            // decrypted post-handshake frame
  | { type: 'rekey-requested' }                           // daemon rekey_request recognized (#108); bare signal, no bytes
  | { type: 'error'; reason: NoiseSessionErrorReason }    // static reason only — never bytes

export interface NoiseSession {
  start(): void
  onFrame(frame: Uint8Array, innerType?: string): void  // innerType: #532, consulted only in awaiting-rekey-reply
  sendMessage(plaintext: Uint8Array): void  // #533: buffers rather than drops in awaiting-rekey-reply
  close(): void
}

export function createNoiseSession(config: NoiseSessionConfig): Promise<NoiseSession>

export const MAX_BUFFERED_SENDS = 8  // #533 — cap on outbound plaintexts held during the rekey window
```

- **Async factory that does *not* send; sending is a separate `start()`.** The factory awaits the wasm load, constructs + `Initialize`s the handshake, and returns the handle **idle**. A send inside the async factory would race a synchronous peer's wiring — so `start()` is split out (the same split #29 established; contrast [`createRelayConnection`](relay-connection.md), which dials on construction because its inbound cannot arrive before the sync constructor returns).
- **Mirrors the relay-connection contract** — raw `Uint8Array` frames out through `sendFrame`, inbound frames in via `onFrame`, lifecycle/errors out through `onEvent` — so the sibling relay-wiring ticket is a thin adapter (`relay {connected}` → `start()`; `relay {message,frame}` → `onFrame`; `sendFrame` = `relay.send`).

### Public surface — `noiseLib.ts` (the AC4 hardened loader)

```ts
export class NoiseLoadError extends Error {
  readonly reason: 'wasm-load-failed' | 'wasm-load-timeout'  // category-only; never the raw wasm text
}
export function loadNoiseLib(options?: { timeoutMs?: number }): Promise<NoiseLib>
```

`createNoise(cb)` has **no async error callback**, so a wasm instantiation that never fires the callback would hang the memoized promise forever (the #29 NIT). The loader converts that to a bounded rejection:

- **Timeout race** — the callback races a `setTimeout(timeoutMs)` (default `10_000` ms, mirroring the relay connect timeout — a hostile/broken-environment backstop, not a happy-path knob; the wasm really loads in tens of ms under Node/vitest). On deadline it rejects with `NoiseLoadError('wasm-load-timeout')`. The timer is cleared on resolve — no leaked timer.
- **Sync-throw classification** — a synchronous throw from `createNoise` rejects with `NoiseLoadError('wasm-load-failed')`, **never** `err.message` (classify-don't-forward — a wasm error string could echo bytes).
- **Memoize success, reset on failure** — the resolved `NoiseLib` is memoized at module scope (one wasm init; concurrent first callers share the promise). On **any** rejection the memo is nulled (`.catch`), so a later call retries a fresh load instead of returning a permanently-poisoned rejected promise.

### State machine (`noiseSession.ts`)

One session walks `idle → awaiting-handshake-reply → transport`, loops back through `awaiting-rekey-reply → transport` on each daemon rekey (#111), or short-circuits to `closed`:

| State | `start()` | `onFrame(frame)` | `sendMessage(p)` |
|---|---|---|---|
| `idle` | write msg 1 (`hello`) → `awaiting-handshake-reply` | `unexpected-frame` (a frame before start) | inert |
| `awaiting-handshake-reply` | inert | read msg 2 → recover `helloAck` → `Split()` → `transport` + emit `handshake-complete`; a throw → `handshake-read-failed`, **close** | inert |
| `transport` | inert | AEAD-decrypt → recognize (#108): a `rekey_request` control envelope → emit `rekey-requested`, then `beginRekey()` (#111: fresh IK msg1 with **empty** early-data → `awaiting-rekey-reply`, OLD ciphers held live); **everything else** → emit `message` (identical bytes); a decrypt throw → `transport-decrypt-failed` (cipher survives; non-terminal) | AEAD-seal → `sendFrame` |
| `awaiting-rekey-reply` (#111, routing since [#532](../codebase/532.md)) | inert | **labelled `noise_resp` or unlabelled** → read daemon reply → `Split()` → **atomic swap** (install both new ciphers, then free both old) → `transport`, **no event**, then flush any buffered sends (#533); a throw → `handshake-read-failed` back to `transport` (**old ciphers intact, usable — not `closed`**), then discard any buffered sends and `rekey-send-abandoned` if any were held (#533). **Labelled anything else** → decrypt under the still-live OLD `recvCipher` → emit `message` (state unchanged, self-loop); a decrypt throw → `transport-decrypt-failed`, **`hs`/state untouched** (reply slot survives) | **buffered, not dropped, since [#533](../codebase/533.md)**: a copy of the plaintext is held (bounded by `MAX_BUFFERED_SENDS`, overflow → `rekey-send-buffer-full` and the incoming send is dropped) and flushed sealed under the new cipher once the swap lands |
| `closed` | inert | inert | inert |

- **`Split()` no-swap.** `noise-c` returns `[send, recv]` **already role-adjusted for both roles** — the JS side does no `(cs1, cs2)` swap; only a raw `flynn/noise` peer needs it, which the daemon already performs (proven byte-for-byte in [#30](../codebase/30.md)). Crossing the two would sail through the handshake and only detonate on the first sealed frame — so the round-trip, not "no error thrown", is the structural pin.
- **Empty prologue.** A zero-length `prologue` is passed as `null` to `Initialize` (noise-c treats zero-length as "no prologue set"), matching the daemon's empty-prologue handshake exactly.

### Pre-decryption byte logging at the inbound-read catches (#133)

The three **inbound-read** catches — `transport-decrypt-failed` (the post-handshake AEAD decrypt), and `handshake-read-failed` at the message-2 read and the rekey-reply read — call a `failWithFrame(reason, frame)` helper instead of plain `fail(reason)`:

```ts
function failWithFrame(reason: NoiseSessionErrorReason, frame: Uint8Array): void {
  config.diagnosticLog?.event({
    event: 'noise-frame-failed', code: reason, bytes: frame.length, safeBytes: encodeSafeBytes(frame)
  })
  fail(reason)
}
```

`frame` at each of these three sites is **inbound, pre-decryption** bytes — AEAD ciphertext, or Noise handshake message 2 / rekey reply (ephemeral pubkey + encrypted static + MAC) — never client plaintext or a secret, so it is safe to log verbatim (capped, hex-encoded via [`encodeSafeBytes`](diagnostic-log.md)). The **outbound-write** catches (`start()`'s msg1 write, `beginRekey()`'s msg1 write) and the pre-`start()` `unexpected-frame` deliberately stay on plain `fail()` — message 1 carries the device token as early-data, so no catch that touches an outbound write ever logs bytes. Absent an injected `diagnosticLog`, `failWithFrame` degrades to exactly `fail(reason)` (optional-chaining short-circuits the whole call). The logged bytes reach only the main-process sink, never `config.onEvent` — the `{ type: 'error', reason }` surface is unchanged.

### Rekey-request recognition (#108)

In v2 the **daemon is the rekey initiator**: on a ~1-hour per-session timer it AEAD-seals a `{type:"rekey_request"}` control envelope and sends it as a transport frame to nudge the client to re-handshake ([#108](../codebase/108.md), daemon twin pyrycode #454). In `transport` state the session now recognizes that trigger, between the successful decrypt and the `message` emit:

```ts
function isRekeyRequest(plaintext: Uint8Array): boolean {
  try { return decodeEnvelope(plaintext).type === REKEY_REQUEST_TYPE } catch { return false }
}
// in onFrame's transport branch, after plaintext = recvCipher.DecryptWithAd(∅, frame):
if (isRekeyRequest(plaintext)) { onEvent({ type: 'rekey-requested' }); return }
onEvent({ type: 'message', plaintext })  // unchanged
```

- **Purely additive — it diverts, it never re-decodes an app message.** Only a positively-classified `rekey_request` is pulled out (as a bare `rekey-requested` signal); everything else — a well-formed app message, an unmodeled control type, non-`Envelope` bytes, or a peek that throws — falls through to the **unchanged** `message` path carrying the **identical** decrypted bytes. [`parseInboundMessage`](inbound-message-decode.md) stays the **sole** app-message decode/narrow authority; recognition is not a second decode gate for app messages.
- **Fail-closed and total.** `isRekeyRequest` reuses the vetted, fail-closed [`decodeEnvelope`](wire-codec.md) and swallows its `WireDecodeError` to `false`, so **any** decode/peek failure reproduces today's behavior — a peek failure is never a rejection, never terminates the session, and never mutates cipher state. It reads only `.type`; the control payload (`{reason}`) is discarded, never interpreted.
- **`REKEY_REQUEST_TYPE = 'rekey_request'` is module-private and deliberately NOT in the shared `EnvelopeType` union** (`types.ts` stays untouched — no wire-type drift). `Envelope.type` is `EnvelopeType | string`, so the comparison type-checks without it. This mirrors the daemon's own asymmetry: pyrycode #454 added `TypeRekeyRequest` as a constant but kept it out of its app-dispatch `v1TypeSet` — a control type, not an app-dispatch type.
- **Cipher state is safe on both paths.** `DecryptWithAd` advances the receive nonce **before** the recognizer runs, and the recognizer holds no cipher reference — so corruption from recognition is structurally impossible.
- **Recognition self-triggers the action (#111).** After emitting the bare `rekey-requested` signal, the `transport` branch now calls `beginRekey()` — the re-handshake + atomic cipher swap ([#111](../codebase/111.md), split from [#109](https://github.com/pyrycode/pyrycode-desktop/issues/109)); see [Rekey re-handshake + atomic cipher swap](#rekey-re-handshake--atomic-cipher-swap-111) below. The `rekey-requested` event stays a pure in-main observability signal — the [noise relay driver](noise-relay-driver.md) still **drops** it (the build-integrity guard) and the action is entirely session-internal, so no driver change was needed.

### Rekey re-handshake + atomic cipher swap (#111)

Recognition alone left a long-lived session still torn down at the daemon's ~1-hour rekey interval (WS 4426) — the driver dropped the trigger and nothing acted on it. [#111](../codebase/111.md) adds the **action** at the session layer: on the recognized `rekey_request` the session runs a **fresh in-session IK handshake as INITIATOR** and, on the daemon's reply, atomically swaps its cipher states — so transport encrypt/decrypt resume under new keys and the session outlives the rekey interval. In v2 the daemon is the rekey initiator (pyrycode #453): it seals the `rekey_request`, opens a ~30 s window, expects the client's fresh `noise_init`, swaps its own `CipherState`s under a peer-static continuity check, and resumes — there is **no `rekey_ack`**, the implicit ack is the next AEAD round-trip.

```
transport, inbound rekey_request → onEvent({rekey-requested})   [#108 signal, driver drops it]
  beginRekey(): fresh HandshakeState(INITIATOR), same keys, WriteMessage(EMPTY_AD)  [NOT config.hello]
              hs=fresh; state='awaiting-rekey-reply'; sendFrame(msg1)   [OLD ciphers retained live]
awaiting-rekey-reply, inbound daemon reply
  hs.ReadMessage(frame,true) [discard early-data]; hs.Split() → [newSend,newRecv]
    ├ throws → hs=null; state='transport'; fail('handshake-read-failed')   [OLD ciphers intact, usable]
    └ ok → prev=(send,recv); sendCipher=newSend; recvCipher=newRecv; free(prev)
           hs=null; state='transport'                                     [resume under NEW keys, no event]
```

- **The fresh handshake is byte-identical to the initial one but for the early-data.** Same `NOISE_PROTOCOL` (reused verbatim, never retyped — [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md)), same injected static keys (`staticPrivateKey` + the pinned `remoteStaticPublicKey`, already in the factory closure), same empty-prologue handling. The only difference: msg1 carries **empty early-data** (`WriteMessage(EMPTY_AD)`, not `config.hello`) and the reply's `hello_ack` is discarded — the device token is **not** re-transmitted on a rekey (spec § Re-key). `lib` is closed over, so the fresh `HandshakeState(INITIATOR)` needs no wasm reload.
- **Atomic swap — never half-swapped.** `ReadMessage` and `Split` are the **only** fallible wasm ops; both run *before* any cipher assignment. On success both new ciphers are installed (two adjacent synchronous assignments, nothing throwing or awaiting between them) *before* either old cipher is freed (guarded `try { obj?.free() } catch {}`, mirroring `freeAll`); on any throw no assignment ran and both old ciphers survive. So the session is **never** left with one new cipher and one old — success ⇒ both new, failure ⇒ both old. `Split()` returns `[send, recv]` **role-adjusted, no pair swap** — the identical mapping to the initial handshake.
- **A failed rekey stays `transport` and usable — the load-bearing difference from the initial handshake.** A malformed / wrong-suite reply (or a mid-session peer swap the pinned static can't complete) throws in `ReadMessage`/`Split` → `hs=null`, `state='transport'` (**not** `closed`), `fail('handshake-read-failed')`, old ciphers intact. A consumer distinguishes "rekey failed, session alive" from "initial handshake failed, session dead" by **recovery state** (`transport` vs `closed`), not by a distinct reason — so **no new `NoiseSessionErrorReason`** is added (`handshake-read-failed` is reused; the driver forwards it untouched).
- **Reusing the pinned static IS the client-side peer-continuity guarantee — no phantom compare.** As the IK initiator the client *supplies* the daemon static (`rs`) in msg1 and never re-learns it from the handshake, so there is nothing to compare; a mid-session peer swap yields diverging DH and surfaces as the existing `handshake-read-failed` (old ciphers intact). The **explicit** peer-static continuity check is the daemon's (pyrycode #452/#453) — belt-and-suspenders, each side owns its own half.
- **Re-entrancy: `hs` + `state` are set before `sendFrame(msg1)`.** A synchronous re-entrant `sendFrame` can drive the daemon's reply straight back into `onFrame`, completing the whole rekey inside `beginRekey`'s send — so the state is armed first, exactly as `start()` sets `state` before `sendFrame`. The successful swap emits **no event** (no `rekey_ack`, no wire marker); an app send during the window is never sent under an ambiguous key — since [#533](../codebase/533.md) it is held as plaintext and flushed only once the swap has installed the new cipher (see [Outbound send buffering across the rekey window](#outbound-send-buffering-across-the-rekey-window-533) below; before #533 it was dropped outright).
- **Session-layer only — wire framing landed in [#112](../codebase/112.md).** This produces the fresh msg1 as raw handshake bytes and swaps ciphers; tagging it `noise_init` on the wire so the real daemon routes it to its rekey responder (instead of transport-decrypting it → WS 4421), and the e2e round-trip against `fakeDaemon`, landed in the follow-on #112 via a driver-local `rekeyInitPending` latch — **no session change**. #112 relies on this feature's synchronous emit-then-send ordering (emit `rekey-requested` → `beginRekey()` → `sendFrame(msg1)` in one `onFrame` turn), so the latch arms exactly as the fresh msg1 reaches the driver.

### Rekey-window routing by inner frame type (#532)

The daemon does not stop the world for a rekey (pyrycode spec #450): it keeps fanning out ordinary
transport frames under the OLD ciphers for the whole `awaiting-reply` window, so an app frame it
emitted after `rekey_request` but before processing the client's fresh `noise_init` is TCP-ordered
**ahead of** the reply. Pre-#532, `onFrame` fed whatever arrived next in `awaiting-rekey-reply`
straight into `hs.ReadMessage` as the reply — so that interleaved app frame MAC-failed, freed the
fresh handshake, and dropped the client to the OLD ciphers while the daemon had already swapped to
the NEW ones. The client's next send then failed the daemon's new receive cipher and the relay tore
the session down (WS 4421). Not a dropped frame — the session was gone.

`onFrame`'s second parameter, `innerType?: string` (the frame's `InnerFrameV2.type`, forwarded
verbatim by the [driver](noise-relay-driver.md)), is read in exactly one state:

```ts
const NOISE_RESP_TYPE = 'noise_resp'  // module-private, sibling to REKEY_REQUEST_TYPE
// in onFrame, state === 'awaiting-rekey-reply':
if (innerType !== undefined && innerType !== NOISE_RESP_TYPE) {
  // window-transport path: decrypt under the still-live OLD recvCipher, emit message, self-loop.
  // A throw here is non-terminal: hs and state are untouched, so the one-shot reply slot survives.
} else {
  // the pre-#532 reply path, byte-for-byte unchanged: hs.ReadMessage → Split → atomic swap.
}
```

- **Positive on `noise_resp`, not negative on `noise_msg`.** An unknown or hostile label takes the
  *gentler* window-transport branch (non-terminal, reply slot preserved) rather than burning the
  one-shot handshake read — the broader, safer reading given a hostile on-path relay can set `type`
  to anything.
- **`undefined` routes to the reply path — the pre-#532 assumption, now written down.** In
  production this arm is **unreachable**: `decodeInnerFrame` rejects a non-string `type` before the
  session ever sees the frame, so the driver always supplies a real label. The arm exists solely so
  the 35 pre-#532 unlabelled test call sites (`noiseSession.test.ts`, `noiseSession.interop.test.ts`,
  `fakeDaemon.test.ts`) keep behaving exactly as before — an optional parameter, not a required one,
  to avoid a fixture cascade across an S-sized ticket.
- **The label chooses a PATH, never a KEY.** Both paths were already reachable, both objects (`hs`,
  the live `recvCipher`) existed before the frame arrived, and the AEAD stays the sole authority on
  whether a frame opens. A relabelling relay only changes *which* of two pre-existing rejections an
  already-doomed frame receives (`transport-decrypt-failed` vs. `handshake-read-failed`) — never a
  downgrade, a transport bypass, or a key/nonce reuse. Mirrors the daemon's own dispatch on the inner
  type (`v2session.go:664-669`), matched on the fake side in [#524](../codebase/524.md).
- **Deliberately no `isRekeyRequest` re-check in the window path.** A `rekey_request` interleaved
  into an already-open window isn't representable (`beginRekey`'s `state !== 'transport'` guard
  would no-op it), and emitting `rekey-requested` here would arm the driver's `rekeyInitPending`
  latch and mis-tag the *next* outbound app frame as `noise_init` after the swap — routing it into
  the daemon's reconnect handler and failing closed. So the window path only decrypts and emits
  `message`, nothing else.

This closed the last routing gap the [#524](../codebase/524.md)/[#525](../codebase/525.md) pair set
up for: #524 taught `fakeDaemon` to route its own rekey window by inner type instead of state alone,
#525 made both fakes tag handshake replies `noise_resp` rather than a uniform `noise_msg`, and this
ticket is the client finally reading that same distinction on its own inbound frames.

### Outbound send buffering across the rekey window (#533)

[#532](../codebase/532.md) fixed the *inbound* half of the rekey-window bug. The *outbound* half was
independent: `sendMessage` no-op'd in every state but `transport`, so a send issued while parked in
`awaiting-rekey-reply` was silently discarded — no queue, no retry, no error — while `composerSend`
posted its optimistic echo into the timeline regardless, painting a message as sent that the daemon
never received.

**Mirroring #532 — sealing under the still-live *old* send cipher — is fatal here, not lossy.** The
client enters `awaiting-rekey-reply` only *after* handing its own `noise_init` to `sendFrame`, so
every windowed send is TCP-ordered **behind** that frame. The daemon swaps **both** ciphers the
moment it processes `noise_init`; an old-cipher frame arriving afterwards fails the daemon's new
`recv` and takes its tampered-frame branch — `closeWith(4421)` and session removal, same as the
pre-#532 desync. So the session holds **plaintext**, never a sealed frame, and re-seals only after
the swap:

```ts
export const MAX_BUFFERED_SENDS = 8
const bufferedSends: Uint8Array[] = []

function sendMessage(plaintext: Uint8Array): void {
  if (state === 'awaiting-rekey-reply') {
    if (bufferedSends.length >= MAX_BUFFERED_SENDS) { fail('rekey-send-buffer-full'); return }
    bufferedSends.push(plaintext.slice())  // copy — session-owned, not an alias into caller state
    return
  }
  if (state !== 'transport' || sendCipher === null) return  // unchanged
  config.sendFrame(sendCipher.EncryptWithAd(EMPTY_AD, plaintext))
}

function flushBufferedSends(): void {
  for (const plaintext of bufferedSends.splice(0)) sendMessage(plaintext)  // take, then drain
}
```

- **Hold plaintext, never a sealed frame.** A `CipherState` is a per-direction nonce counter; sealing
  at `sendMessage` time would burn a nonce under a cipher about to be freed, or leave a gap the
  daemon's receive side can't tolerate. Buffering plaintext keeps the send-nonce stream contiguous by
  construction — nothing is sealed until the instant it is actually sent.
- **Bounded by `MAX_BUFFERED_SENDS = 8`, deliberately diverging from `MAX_PENDING_FRAMES`'s silent
  drop** ([noise relay driver](noise-relay-driver.md)): that buffer holds pre-session frames from a
  potentially-hostile relay, already anomalous garbage; this one holds the user's own message, so
  overflow is surfaced (`rekey-send-buffer-full`) and the **incoming** send is dropped — never the
  oldest, which would silently break issue order. Already bounded in bytes for free:
  `encodeEnvelope` rejects anything over `MAX_PLAINTEXT_BYTES = 65519` upstream in
  `daemonConnection`, so the worst case is a deterministic `MAX_BUFFERED_SENDS × 65519` ≈ 512 KiB.
- **Flush runs strictly after both cipher assignments and the `state = 'transport'` restore, and
  drains *through* `sendMessage`,** not a private seal loop — re-entering the public entry point
  re-reads the *live* `sendCipher` each iteration, so no item can seal under `prevSend` (which the
  swap `free()`s — a use-after-free on a wasm object) and a re-entrant second rekey mid-flush
  re-buffers and flushes the remainder after *that* swap, still in order. `splice(0)` (take before
  drain) is what makes iterating a live, re-entrantly-mutated array — and a double-drain — both
  unrepresentable. Ordering (a post-swap send always lands last) then falls out for free, since the
  flush completes synchronously inside the same `onFrame` turn that performed the swap.
- **On rekey failure the buffer is discarded, unsent, cleared *before* either error is emitted.**
  Re-sending under the surviving old ciphers isn't safe — the client can't distinguish "our
  `noise_init` never reached the daemon" from "the daemon swapped and the reply was corrupted," and
  the latter is the fatal 4421 case — so the only safe branch assumes the worst. Clear-before-emit
  matters because `fail()`/`failWithFrame()` invoke a synchronous consumer that can re-enter
  `sendMessage` while `state` is already back to `transport`; a stale item left behind could
  otherwise be picked up by a *later* window's flush. `rekey-send-abandoned` fires once, only if the
  buffer was non-empty, and never carries a count (content-free discipline — a count would correlate
  with user activity).
- **`close()` releases the buffer and emits nothing** — an error on ordinary teardown would be noise
  on every window close and on the daemon's own 4426 path, the buffer's actual worst-case terminator.
- **Two new closed-set reasons, zero fan-out.** `RelaySessionErrorReason`
  (`noiseRelayDriver.ts`) is *defined as* `NoiseSessionErrorReason | <adapter reasons>`, and
  `daemonConnection`'s reason-forwarding and `messageFor` both have generic/`default` arms — so
  `rekey-send-buffer-full` and `rekey-send-abandoned` reach `emitFailed` →
  `{type:'failed', retryable:false}` with no driver or `daemonConnection` edit. Accepted deliberately,
  including for overflow: same terminal-UI-failure shape the pre-existing non-terminal
  `transport-decrypt-failed` already produces; a softer mapping was rejected as out of scope for an
  S-sized bug fix.
- **A client-side deadline on `awaiting-rekey-reply` remains unbuilt and unfiled** (carried forward by
  #532, raised again by this ticket's security review) — the bound above is what makes that absence
  survivable *for this buffer specifically* (a deterministic ~512 KiB ceiling), not a fix for the
  underlying relay-controlled window length.

### Data flow

```
 relay-wiring ticket (sibling)     createNoiseSession                 noise-c.wasm (main process)
   config{keys,hello,sendFrame,onEvent} ─► loadNoiseLib() ─► HandshakeState(NOISE_PROTOCOL, INITIATOR)
   start() ──────────────► WriteMessage(hello) ─► sendFrame(msg1)         ─── IK msg 1 ──►
                       ◄── ReadMessage(msg2) ─► helloAck + Split()[send,recv]  ◄── IK msg 2 ───
                           onEvent({handshake-complete, helloAck})
   sendMessage(P) ──────► send.EncryptWithAd(∅, P) ─► sendFrame(ct)       ─── frame ──►
   onFrame(ct) ─────────► recv.DecryptWithAd(∅, ct) ─► onEvent({message, plaintext})  ◄── frame ──
   close() ─────────────► free(hs, send, recv); every entry point inert
```

Nothing in this flow reaches IPC, the preload, or the renderer. The `hello`/`helloAck`/`plaintext` cross the API as **opaque bytes**; this module parses no structured data — envelope/base64 decode is the #5 codec's fail-closed job at the wiring layer.

## Error handling — two distinct surfaces

Deliberately different shapes, keyed on whether a handle exists yet:

- **Load failure (before the handle exists) → factory rejection.** `createNoiseSession` (and the folded-in `noiseKeyPairGenerator`) reject with `NoiseLoadError` (`wasm-load-failed` | `wasm-load-timeout`). Category-only. This is the "error/rejection rather than hanging" surface — the correct async shape when no `onEvent` sink is driving frames yet.
- **Runtime failure (handle live) → typed `error` event.** The closed set flows through `onEvent` with a **static reason only, never bytes** — the frame bytes reach only the optional [`diagnosticLog`](diagnostic-log.md) sink at the three inbound-read catches (#133), never `onEvent`. **Fail-closed**: a caught `ReadMessage`/`DecryptWithAd` throw emits the error event and **returns without emitting any `handshake-complete`/`message`** — no partial or leaked plaintext ever reaches the sink. A tampered, wrong-suite, or wrong-key frame MAC-fails inside the vetted library and lands here.

## Security properties

Ticket carries `security-sensitive`; the architect's security review verdict is **PASS** (see the spec's `## Security review`), and code review confirmed it on the diff:

- **Fail-closed transport.** Every inbound frame passes straight into the library's authenticated `ReadMessage`/`DecryptWithAd`, which MAC-verify and throw on failure → caught → typed `error`, never a partial decrypt. A tampered/wrong-suite/wrong-key frame is rejected before any byte surfaces.
- **Injected keys, nothing persisted.** The static private key is a raw 32-byte X25519 local `Uint8Array`, injected as config, held in main-process memory only, freed by `close()`. The module sources no key from storage and generates none (that's [#43](../codebase/43.md)/[#42](../codebase/42.md)); the `hello` may carry a device token but is treated as opaque encrypted bytes.
- **Content-free logging by construction (was log-free; #133 added the one exception).** Zero `console.*` in either file; every diagnostic is a typed reason or a category-only `NoiseLoadError` (never `err.message`). Pinned by a six-method `console`-spy assertion across handshake + transport + error **and the load-failure path**. The one exception: the three inbound-read catches now log the capped raw pre-decryption frame through an optional injected [`DiagnosticLog`](diagnostic-log.md) (§ *Pre-decryption byte logging*, [#133](../codebase/133.md)) — safe because those bytes are ciphertext / handshake material, never plaintext or a secret; the outbound-write catches (which touch the token-bearing message 1) stay byte-free, pinned by a boundary test.
- **No use-after-close.** `close()` frees the per-handshake / per-cipher wasm objects and flips state to `closed`; every entry point then guards on state / nulled handles and is inert — no call into a freed wasm object (a real heap-corruption vector). On a handshake read/write error the library auto-frees `hs` before throwing, so the catch nulls it to stay in step. This close-during-handshake invariant is pinned by a named regression fixture ([#33](../codebase/33.md), mobile #497 parity) — a garbage frame after `close()` in any state is dropped without re-entering freed wasm; the tests defend the guards, deliberately **not** a synchronization primitive (the single-threaded synchronous model makes the mutex mobile added a non-race).
- **No renderer/IPC surface.** No `BrowserWindow`, `contextBridge`, `ipcMain`, or preload; a renderer compromise gains no path to keys, wasm, or cipher state.

## Edge cases and limitations

- **Not wired to the relay yet.** The session factory has **no production caller** — `sendFrame`/`onFrame` are injected, and the relay-socket wiring (session ↔ [`createRelayConnection`](relay-connection.md) ↔ #5 codec) is a sibling split ticket. Only the tests and the keygen fold-in touch it, so the rename cascaded to zero production consumers.
- **wasm bundling for the packaged app is unproven.** Both spikes load the wasm only under Node/vitest; electron-vite **bundling** of the base64-embedded wasm asset for the packaged app is an open question flagged forward from #29/#30, **out of scope** here.
- **Re-key: recognition + session-layer action + wire framing + e2e all landed.** The daemon's in-session `rekey_request` trigger is **recognized** ([#108](../codebase/108.md), split from [#76](https://github.com/pyrycode/pyrycode-desktop/issues/76)) **and acted on** ([#111](../codebase/111.md), split from [#109](https://github.com/pyrycode/pyrycode-desktop/issues/109)): the session runs a fresh in-session IK handshake and atomically swaps its ciphers, so it can outlive the daemon's rekey interval. The fresh msg1 is now **tagged `noise_init` on the wire** and the round-trip is proven **end-to-end** against a rekey-initiating [`fakeDaemon`](fake-daemon.md#rekey-initiator-capability-112) ([#112](../codebase/112.md), via a driver-local latch — no session change); lost-rekey recovery (mobile #495) is now unblocked. The close-during-handshake safety invariant is pinned by [#33](../codebase/33.md) (test-only — the guards above already enforce it) and now also covers the `awaiting-rekey-reply` phase: a `close()` mid-rekey frees the fresh `hs` plus both old ciphers via `freeAll`, no leak, every entry point inert.
- **`hello`/`helloAck` envelope semantics are opaque** — construction/parsing is the [hello exchange](hello-exchange.md) layer ([#10](../codebase/10.md)).
- **A throwing `sendFrame`/`onEvent` is a caller bug, not defended** — trusted internal sinks, per the relay-connection discipline.
- **Wrong peer-static surfaces at the *responder*, not the initiator.** With a wrong `remoteStaticPublicKey`, the encrypted static in msg 1 MAC-fails on the daemon side; the initiator simply never receives msg 2 (no `handshake-complete`) rather than emitting `handshake-read-failed` (a #30 finding — a live key mismatch shows up as a `4426` close, not a local error).

## Related

- [#7 codebase notes](../codebase/7.md) — implementation summary, patterns, lessons.
- [#108 codebase notes](../codebase/108.md) — the `rekey_request` recognition seam added to `transport` state (the type-peek, the module-private constant, the driver build-integrity edit); daemon twin pyrycode #454.
- [#111 codebase notes](../codebase/111.md) — the **action** on the recognized trigger: the in-session IK re-handshake as initiator + the atomic cipher swap (`beginRekey`, the `awaiting-rekey-reply` phase, empty early-data, a failure returns to `transport` not `closed`); daemon twin pyrycode #453/#435.
- [#532 codebase notes](../codebase/532.md) — the rekey-window desync fix: `onFrame`'s optional `innerType` parameter and the routing rule in `awaiting-rekey-reply` (§ *Rekey-window routing by inner frame type*); closes the permanent-desync bug where an app frame interleaved into the window was consumed as the handshake reply.
- [#533 codebase notes](../codebase/533.md) — the outbound mirror of #532: `sendMessage`'s new first branch, `MAX_BUFFERED_SENDS`, and the flush-after-swap/discard-on-failure lifecycle (§ *Outbound send buffering across the rekey window*); closes the silent-drop bug where a windowed send was discarded with no queue, retry, or error.
- [Content-free diagnostic log](diagnostic-log.md) / [#133 codebase notes](../codebase/133.md) — the optional injected `diagnosticLog` this session now logs through at the three inbound-read catches (§ *Pre-decryption byte logging*), carrying the capped raw ciphertext / handshake bytes via the branded `safeBytes` field; forwarded in by the [noise relay driver](noise-relay-driver.md).
- [Inbound message decode](inbound-message-decode.md) / [#68](../codebase/68.md) — the downstream `parseInboundMessage` whose `default → null` branch silently dropped `rekey_request` before #108; stays the sole app-message decode authority.
- [#29 codebase notes](../codebase/29.md) — the library-selection spike that chose `noise-c.wasm`, established the harness contract, and flagged the async-load NIT this ticket closes.
- [#30 codebase notes](../codebase/30.md) — the Go↔JS interop spike (verdict **RECOMMEND**); the byte-accurate interop invariants and the `Split()` asymmetry this session inherits.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — the injected identity `s`, whose generator now shares this ticket's `noiseLib` loader.
- [Relay connection](relay-connection.md) / [#21](../codebase/21.md) — the byte-pipe transport whose contract this session mirrors, wired underneath it by the sibling ticket.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — the framing (`encode/decodeEnvelope`, `base64Std*`) that wraps encrypt/decrypt at the wiring layer.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the load-bearing suite pin and "a mismatch fails the handshake silently"; the security model (keys never reach the renderer).
- Go peer (QMD `pyrycode-docs`): `internal/noise` (#433) — the daemon's `flynn/noise` IK wrapper this session interoperates with byte-for-byte.
