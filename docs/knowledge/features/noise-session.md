# Noise session

The **production Noise session**: a pure main-process crypto unit that performs the `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake with the daemon and then encrypts/decrypts transport frames, so the relay socket can carry a **confidential, authenticated** channel. It is the desktop equivalent of the mobile client's Noise session and the JS peer of the daemon's Go `flynn/noise` stack (pyrycode `internal/noise`, #433) — reuse is the **wire format**, not code.

Introduced in [#7](../codebase/7.md), which **promotes** the throwaway `createNoiseInitiator` harness proven by the two Noise spikes ([#29](../codebase/29.md) library selection, [#30](../codebase/30.md) Go↔JS interop, verdict **RECOMMEND**) into a production module — `git mv` + rename carries the proven state machine verbatim; the one genuinely new surface is a shared hardened wasm loader. It lives **entirely** in `src/main/transport/` alongside the [relay connection](relay-connection.md) whose `send`-out / `onEvent`-in shape it mirrors ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). Keys, wasm, cipher state, and plaintext never reach the renderer, preload, or IPC.

## What it does

Gives the background process **one factory** — `createNoiseSession(config): Promise<NoiseSession>` — that builds an IK **initiator** from injected keys and returns an idle handle:

- **`start()`** writes IK message 1 (carrying the injected `hello` as early-data) to `sendFrame`, exactly once.
- **`onFrame(frame)`** feeds one inbound frame: first it reads message 2 (recovering `hello_ack` and splitting into transport ciphers), then every later frame is AEAD-decrypted.
- **`sendMessage(plaintext)`** AEAD-seals one post-handshake plaintext to `sendFrame`.
- **`close()`** frees the wasm handshake + cipher state and leaves every entry point inert.

It is a **pure crypto unit**: keys are **injected** (raw 32-byte X25519 static private + remote static public), it sources nothing from storage and constructs no envelope. The `hello`/`helloAck` are **opaque bytes** — building them (device-token envelope) is the [hello exchange](hello-exchange.md) layer's job ([#10](../codebase/10.md)); sourcing the keypair is [#43](../codebase/43.md)'s. The suite `NOISE_PROTOCOL` is reused **verbatim** from `src/shared/wire/types.ts` — a mismatch fails the handshake **silently** ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md)), so it is never retyped.

## How it works

Two production files in `src/main/transport/`:

| File | Role |
|---|---|
| `noiseSession.ts` | The production session: the config/event/handle contract, the `idle → awaiting-handshake-reply → transport → closed` state machine, `freeAll()`, empty-AD encrypt/decrypt, the `Split()` no-swap, fail-closed decrypt, and no-use-after-close guards. Carried verbatim from the #29/#30 harness (renamed only). |
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
}

export type NoiseSessionErrorReason =
  | 'handshake-read-failed'      // msg 2 failed MAC / malformed / wrong-suite / wrong-key peer
  | 'transport-decrypt-failed'   // a post-handshake frame failed to open (tamper / wrong key)
  | 'unexpected-frame'           // a frame arrived in the wrong state

export type NoiseSessionEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array }  // peer early-data recovered from msg 2
  | { type: 'message'; plaintext: Uint8Array }            // decrypted post-handshake frame
  | { type: 'error'; reason: NoiseSessionErrorReason }    // static reason only — never bytes

export interface NoiseSession {
  start(): void
  onFrame(frame: Uint8Array): void
  sendMessage(plaintext: Uint8Array): void
  close(): void
}

export function createNoiseSession(config: NoiseSessionConfig): Promise<NoiseSession>
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

One session walks `idle → awaiting-handshake-reply → transport`, or short-circuits to `closed`:

| State | `start()` | `onFrame(frame)` | `sendMessage(p)` |
|---|---|---|---|
| `idle` | write msg 1 (`hello`) → `awaiting-handshake-reply` | `unexpected-frame` (a frame before start) | inert |
| `awaiting-handshake-reply` | inert | read msg 2 → recover `helloAck` → `Split()` → `transport` + emit `handshake-complete`; a throw → `handshake-read-failed`, close | inert |
| `transport` | inert | AEAD-decrypt → emit `message`; a throw → `transport-decrypt-failed` (cipher survives; non-terminal) | AEAD-seal → `sendFrame` |
| `closed` | inert | inert | inert |

- **`Split()` no-swap.** `noise-c` returns `[send, recv]` **already role-adjusted for both roles** — the JS side does no `(cs1, cs2)` swap; only a raw `flynn/noise` peer needs it, which the daemon already performs (proven byte-for-byte in [#30](../codebase/30.md)). Crossing the two would sail through the handshake and only detonate on the first sealed frame — so the round-trip, not "no error thrown", is the structural pin.
- **Empty prologue.** A zero-length `prologue` is passed as `null` to `Initialize` (noise-c treats zero-length as "no prologue set"), matching the daemon's empty-prologue handshake exactly.

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
- **Runtime failure (handle live) → typed `error` event.** The closed set flows through `onEvent` with a **static reason only, never bytes**. **Fail-closed**: a caught `ReadMessage`/`DecryptWithAd` throw emits the error event and **returns without emitting any `handshake-complete`/`message`** — no partial or leaked plaintext ever reaches the sink. A tampered, wrong-suite, or wrong-key frame MAC-fails inside the vetted library and lands here.

## Security properties

Ticket carries `security-sensitive`; the architect's security review verdict is **PASS** (see the spec's `## Security review`), and code review confirmed it on the diff:

- **Fail-closed transport.** Every inbound frame passes straight into the library's authenticated `ReadMessage`/`DecryptWithAd`, which MAC-verify and throw on failure → caught → typed `error`, never a partial decrypt. A tampered/wrong-suite/wrong-key frame is rejected before any byte surfaces.
- **Injected keys, nothing persisted.** The static private key is a raw 32-byte X25519 local `Uint8Array`, injected as config, held in main-process memory only, freed by `close()`. The module sources no key from storage and generates none (that's [#43](../codebase/43.md)/[#42](../codebase/42.md)); the `hello` may carry a device token but is treated as opaque encrypted bytes.
- **Log-free by construction.** Zero `console.*` in either file; every diagnostic is a typed reason or a category-only `NoiseLoadError` (never `err.message`). Pinned by a six-method `console`-spy assertion across handshake + transport + error **and the load-failure path**.
- **No use-after-close.** `close()` frees the per-handshake / per-cipher wasm objects and flips state to `closed`; every entry point then guards on state / nulled handles and is inert — no call into a freed wasm object (a real heap-corruption vector). On a handshake read/write error the library auto-frees `hs` before throwing, so the catch nulls it to stay in step.
- **No renderer/IPC surface.** No `BrowserWindow`, `contextBridge`, `ipcMain`, or preload; a renderer compromise gains no path to keys, wasm, or cipher state.

## Edge cases and limitations

- **Not wired to the relay yet.** The session factory has **no production caller** — `sendFrame`/`onFrame` are injected, and the relay-socket wiring (session ↔ [`createRelayConnection`](relay-connection.md) ↔ #5 codec) is a sibling split ticket. Only the tests and the keygen fold-in touch it, so the rename cascaded to zero production consumers.
- **wasm bundling for the packaged app is unproven.** Both spikes load the wasm only under Node/vitest; electron-vite **bundling** of the base64-embedded wasm asset for the packaged app is an open question flagged forward from #29/#30, **out of scope** here.
- **No re-key, no close-during-handshake robustness** — deferred to [#33](../codebase). The session handles one handshake + a transport phase, then `close()`.
- **`hello`/`helloAck` envelope semantics are opaque** — construction/parsing is the [hello exchange](hello-exchange.md) layer ([#10](../codebase/10.md)).
- **A throwing `sendFrame`/`onEvent` is a caller bug, not defended** — trusted internal sinks, per the relay-connection discipline.
- **Wrong peer-static surfaces at the *responder*, not the initiator.** With a wrong `remoteStaticPublicKey`, the encrypted static in msg 1 MAC-fails on the daemon side; the initiator simply never receives msg 2 (no `handshake-complete`) rather than emitting `handshake-read-failed` (a #30 finding — a live key mismatch shows up as a `4426` close, not a local error).

## Related

- [#7 codebase notes](../codebase/7.md) — implementation summary, patterns, lessons.
- [#29 codebase notes](../codebase/29.md) — the library-selection spike that chose `noise-c.wasm`, established the harness contract, and flagged the async-load NIT this ticket closes.
- [#30 codebase notes](../codebase/30.md) — the Go↔JS interop spike (verdict **RECOMMEND**); the byte-accurate interop invariants and the `Split()` asymmetry this session inherits.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — the injected identity `s`, whose generator now shares this ticket's `noiseLib` loader.
- [Relay connection](relay-connection.md) / [#21](../codebase/21.md) — the byte-pipe transport whose contract this session mirrors, wired underneath it by the sibling ticket.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — the framing (`encode/decodeEnvelope`, `base64Std*`) that wraps encrypt/decrypt at the wiring layer.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the load-bearing suite pin and "a mismatch fails the handshake silently"; the security model (keys never reach the renderer).
- Go peer (QMD `pyrycode-docs`): `internal/noise` (#433) — the daemon's `flynn/noise` IK wrapper this session interoperates with byte-for-byte.
